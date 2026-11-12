import { expect, test, type Page } from '@playwright/test';
import { SINK_ORIGIN } from './constants';
import { emailInput, interceptSignup, fulfillJson, openLanding, submitButton, uniqueEmail } from './helpers';

/* ---------- reading what actually left the app ---------- */
interface Sent {
  seq: number;
  endpoint: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

const sentBy = async (vid: string): Promise<Sent[]> => {
  const all: Sent[] = await (await fetch(`${SINK_ORIGIN}/__events?distinct_id=${vid}`)).json();
  // Client and server clocks are the same machine: order by event time (then arrival) = causal order.
  return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.seq - b.seq);
};

/** Wait until the sink has `count` events for this visitor (the client batches on idle/interaction/pagehide). */
async function eventsOf(page: Page, vid: string, count: number): Promise<Sent[]> {
  await page.evaluate(() => dispatchEvent(new Event('pagehide'))); // flush the client queue now instead of waiting for idle
  await expect.poll(async () => (await sentBy(vid)).length, { timeout: 10_000, message: `waiting for ${count} analytics events` }).toBe(count);
  return sentBy(vid);
}

/**
 * Volatile fields (ids, clocks, sequence) become placeholders so a failing comparison prints a readable
 * expected-vs-actual PAYLOAD diff, not noise. Context fields stay: they are part of the contract.
 */
const view = (events: Sent[], vid: string, userId?: string) =>
  events.map((e) => ({
    event: e.event,
    lib: e.properties.$lib,
    distinct_id: e.distinct_id === vid ? '<visitor>' : e.distinct_id,
    props: Object.fromEntries(
      Object.entries(e.properties)
        .filter(([k]) => !['$lib', '$process_person_profile'].includes(k))
        .map(([k, v]) => [k, userId && v === userId ? '<user_id>' : v]),
    ),
  }));

const context = (variant = 'control') => ({ experiment: 'signup_fields', variant, env: 'test' });
const deviceFor = (page: Page) => ((page.viewportSize()?.width ?? 1280) < 768 ? 'mobile' : 'desktop');

async function doFunnel(page: Page, email: string, name = 'Ada Lovelace') {
  await emailInput(page).focus(); // → signup_started
  await emailInput(page).fill('nope');
  await submitButton(page).click(); // → signup_failed (client_validation)
  await emailInput(page).fill(email);
  await page.getByLabel('Name (optional)').fill(name);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/users') && r.request().method() === 'POST');
  await submitButton(page).click(); // → signup_submitted, then the server emits signup_succeeded
  return response;
}

test.describe('analytics: the data that leaves the page', () => {
  test('full funnel with UTMs: right events, right order, right properties, each exactly once, no PII', async ({ page }) => {
    const email = uniqueEmail();
    const vid = await openLanding(page, 'control', '?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=SECRET-CLICK-ID&email=leak%40example.com&foo=bar');
    const response = await doFunnel(page, email, 'Ada Lovelace');
    expect(response.status()).toBe(201);
    const userId = (await response.json()).data.id as string;

    const events = await eventsOf(page, vid, 5);

    expect(view(events, vid, userId)).toEqual([
      { event: 'landing_viewed', lib: 'fxr-web', distinct_id: '<visitor>', props: { ...context(), device_class: deviceFor(page), utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring' } },
      { event: 'signup_started', lib: 'fxr-web', distinct_id: '<visitor>', props: { ...context(), fields_shown: ['email', 'name'] } },
      { event: 'signup_failed', lib: 'fxr-web', distinct_id: '<visitor>', props: { ...context(), source: 'client_validation', error_code: 'validation_error', failed_fields: ['email'], retryable: false } },
      { event: 'signup_submitted', lib: 'fxr-web', distinct_id: '<visitor>', props: { ...context(), attempt: 1, name_provided: true } },
      { event: 'signup_succeeded', lib: 'fxr-server', distinct_id: '<visitor>', props: { ...context(), user_id: '<user_id>', name_provided: true, $insert_id: '<user_id>' } },
    ]);

    // Browser events travel in ONE batch; the conversion is its own server-side request.
    expect(events.filter((e) => e.endpoint === '/batch/')).toHaveLength(4);
    expect(events.filter((e) => e.endpoint === '/i/v0/e/').map((e) => e.event)).toEqual(['signup_succeeded']);

    // Non-allow-listed params, the email and the name never leave the page, in ANY field of ANY payload.
    const everything = JSON.stringify(events);
    for (const secret of ['SECRET-CLICK-ID', 'gclid', 'leak@example.com', 'leak%40example.com', 'foo', email, 'Ada', 'Lovelace', 'nope']) {
      expect(everything, `payload must not contain "${secret}"`).not.toContain(secret);
    }
    // The conversion belongs to the user that the API created, and was emitted after the request was made.
    const submitted = events.find((e) => e.event === 'signup_submitted')!;
    const succeeded = events.find((e) => e.event === 'signup_succeeded')!;
    expect(succeeded.properties.user_id).toBe(userId);
    expect(succeeded.timestamp >= submitted.timestamp).toBe(true);
  });

  test('email_only arm reports its arm and only the fields it shows', async ({ page }) => {
    const vid = await openLanding(page, 'email_only');
    await emailInput(page).focus();
    const events = await eventsOf(page, vid, 2);
    expect(view(events, vid)).toEqual([
      { event: 'landing_viewed', lib: 'fxr-web', distinct_id: '<visitor>', props: { ...context('email_only'), device_class: deviceFor(page) } },
      { event: 'signup_started', lib: 'fxr-web', distinct_id: '<visitor>', props: { ...context('email_only'), fields_shown: ['email'] } },
    ]);
  });

  test('signup_succeeded exists only for a real 201 from the server (the browser can never emit the conversion)', async ({ page }) => {
    const vid = await openLanding(page);
    await interceptSignup(page, (route) => fulfillJson(route, 500, { error: { code: 'internal_error', message: 'x' } })); // the server never sees this request
    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).click();
    await expect(page.locator('#signup form').getByText('Something went wrong on our side. Please try again.')).toBeVisible();
    const events = await eventsOf(page, vid, 3); // landing_viewed, signup_started, signup_submitted
    expect(events.map((e) => e.event)).toEqual(['landing_viewed', 'signup_started', 'signup_submitted']);
    expect(events.map((e) => e.event)).not.toContain('signup_succeeded');
  });

  test('a real server-side 409 is reported by the SERVER as signup_failed(email_taken), not by the browser, and is no conversion', async ({ page, request }) => {
    const taken = uniqueEmail();
    expect((await request.post('/api/users', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { email: taken } })).status()).toBe(201);
    const vid = await openLanding(page);
    await emailInput(page).fill(taken);
    await submitButton(page).click();
    await expect(page.locator('#signup-email-error')).toBeVisible();
    const events = await eventsOf(page, vid, 4);
    expect(view(events, vid).map((e) => [e.event, e.lib])).toEqual([
      ['landing_viewed', 'fxr-web'],
      ['signup_started', 'fxr-web'],
      ['signup_submitted', 'fxr-web'],
      ['signup_failed', 'fxr-server'],
    ]);
    expect(events[3]!.properties).toMatchObject({ source: 'server', error_code: 'email_taken', retryable: false });
    expect(JSON.stringify(events)).not.toContain(taken);
  });

  test('network failure is reported by the browser as signup_failed(network, retryable); the retry is a second submitted attempt', async ({ page }) => {
    const vid = await openLanding(page);
    const attempts = await interceptSignup(page, (route, n) => (n === 1 ? route.abort('failed') : route.continue()));
    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).click();
    await expect(page.locator('#signup form').getByText('Connection problem. Check your connection and try again.')).toBeVisible();
    await submitButton(page).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    expect(attempts).toHaveLength(2);
    const events = await eventsOf(page, vid, 6);
    expect(events.map((e) => e.event)).toEqual(['landing_viewed', 'signup_started', 'signup_submitted', 'signup_failed', 'signup_submitted', 'signup_succeeded']);
    expect(events[3]!.properties).toMatchObject({ source: 'network', error_code: 'network_error', retryable: true });
    expect([events[2]!.properties.attempt, events[4]!.properties.attempt]).toEqual([1, 2]);
  });

  test('Global Privacy Control ⇒ ZERO events from browser and server, and signup still works', async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ 'Sec-GPC': '1' }); // what a GPC browser sends on every request (server side)
    await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true })); // client side
    const toSink: string[] = [];
    page.on('request', (r) => r.url().startsWith(SINK_ORIGIN) && toSink.push(r.url()));
    const email = uniqueEmail();
    const vid = await openLanding(page);
    const response = await doFunnel(page, email);
    expect(response.status()).toBe(201);
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(2500); // longer than the 2 s idle flush window: if anything were going to be sent, it would have been
    expect(await sentBy(vid)).toEqual([]);
    expect(toSink).toEqual([]);
  });

  test('double-click submit ⇒ one POST, one signup_submitted, one signup_succeeded', async ({ page }) => {
    const vid = await openLanding(page);
    let posts = 0;
    page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/users') && (posts += 1));
    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).dblclick();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    const events = await eventsOf(page, vid, 4);
    expect(posts).toBe(1);
    expect(events.map((e) => e.event)).toEqual(['landing_viewed', 'signup_started', 'signup_submitted', 'signup_succeeded']);
  });

  test('reload after success ⇒ no signup_* re-fires (the new page view is a new landing_viewed); a bfcache-style pageshow adds nothing', async ({ page }) => {
    const vid = await openLanding(page);
    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    await eventsOf(page, vid, 4);

    await page.reload();
    await expect(submitButton(page)).toBeEnabled();
    let events = await eventsOf(page, vid, 5);
    expect(events.filter((e) => e.event === 'signup_succeeded')).toHaveLength(1);
    expect(events.filter((e) => e.event === 'signup_submitted')).toHaveLength(1);
    expect(events.filter((e) => e.event === 'landing_viewed')).toHaveLength(2);

    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    events = await sentBy(vid);
    expect(events.filter((e) => e.event === 'landing_viewed')).toHaveLength(2);
  });

  test('idempotent replay (same key + body twice) ⇒ both 201, exactly ONE conversion', async ({ request }) => {
    const vid = crypto.randomUUID();
    const key = crypto.randomUUID();
    const send = () => request.post('/api/users', { headers: { 'Idempotency-Key': key, 'X-Visitor-Id': vid, Cookie: 'fxr_variant=control' }, data: { email: `replay-${key}@example.com` } });
    const [first, second] = [await send(), await send()];
    expect([first.status(), second.status()]).toEqual([201, 201]);
    expect(second.headers()['idempotent-replayed']).toBe('true');
    await expect.poll(async () => (await sentBy(vid)).length, { timeout: 10_000 }).toBe(1);
    await new Promise((r) => setTimeout(r, 750)); // a late duplicate would show up here
    expect((await sentBy(vid)).map((e) => e.event)).toEqual(['signup_succeeded']);
  });

  test('analytics stores nothing in the browser: only fxr_vid and fxr_variant exist', async ({ page, context }) => {
    const vid = await openLanding(page);
    await doFunnel(page, uniqueEmail());
    await eventsOf(page, vid, 5);
    expect((await context.cookies()).map((c) => c.name).sort()).toEqual(['fxr_variant', 'fxr_vid']);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  });
});
