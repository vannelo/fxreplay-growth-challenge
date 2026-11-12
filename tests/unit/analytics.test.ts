import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createTracker, type TrackerConfig } from '../../src/analytics/client';
import { defer } from '../../src/analytics/defer';
import { AnalyticsViolation, EVENT_PROPS, sanitize } from '../../src/analytics/events';
import { landingProps } from '../../src/analytics/landing';
import { gpcOptedOut } from '../../src/analytics/payload';
import { createServerAnalytics } from '../../src/analytics/server';

const VID = '11111111-1111-4111-8111-111111111111';

/* ---------- registry: allow-list + PII guard ---------- */
describe('sanitize (allow-list + PII guard)', () => {
  it('passes a valid event through unchanged', () => {
    const props = { source: 'network', error_code: 'network_error', retryable: true } as const;
    expect(sanitize('signup_failed', props, true)).toEqual(props);
  });

  it.each([
    ['an email-like value', { fields_shown: ['a@b.co'] }],
    ['an email inside a longer string', { fields_shown: ['please mail me at x@y.io today'] }],
  ])('THROWS in dev/test for %s', (_l, props) => {
    expect(() => sanitize('signup_started', props as never, true)).toThrow(AnalyticsViolation);
  });

  it('throws for a property outside the allow-list, even with a harmless value', () => {
    expect(() => sanitize('signup_submitted', { attempt: 1, name_provided: true, extra: 'x' } as never, true)).toThrow(/not allowed/);
  });

  it('throws for an over-long string', () => {
    expect(() => sanitize('landing_viewed', { device_class: 'mobile', utm_source: 'x'.repeat(101) }, true)).toThrow(/exceeds/);
  });

  it('DROPS (returns null, warns) in production instead of breaking the page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(sanitize('signup_started', { fields_shown: ['a@b.co'] } as never, false)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('event dropped'));
    warn.mockRestore();
  });

  it('never echoes the offending value in its message (the message itself must not leak PII)', () => {
    try {
      sanitize('signup_started', { fields_shown: ['secret@leak.example'] } as never, true);
    } catch (e) {
      expect((e as Error).message).not.toContain('secret@leak.example');
    }
  });
});

/* ---------- drift: registry vs docs/analytics-plan.md ---------- */
describe('registry matches docs/analytics-plan.md (drift test)', () => {
  const plan = readFileSync('docs/analytics-plan.md', 'utf8');
  const section = plan.slice(plan.indexOf('## Events'), plan.indexOf('## Funnel'));
  const rows = section.split('\n').filter((l) => /^\| `[a-z_]+` \|/.test(l));
  const cells = (line: string) => line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
  const planned = Object.fromEntries(
    rows.map((row) => {
      const [event, , , properties] = cells(row);
      const props = [...properties!.matchAll(/`([a-z_]+)\??`/g)].map((m) => m[1]!);
      return [event!.replaceAll('`', ''), props.sort()];
    }),
  );

  it('has exactly the same events', () => {
    expect(Object.keys(planned).sort()).toEqual(Object.keys(EVENT_PROPS).sort());
  });

  it.each(Object.keys(EVENT_PROPS))('%s has exactly the planned properties', (name) => {
    expect([...EVENT_PROPS[name as keyof typeof EVENT_PROPS]].sort()).toEqual(planned[name]);
  });
});

/* ---------- landing props ---------- */
describe('landingProps: only allow-listed, bounded, PII-free values', () => {
  const base = { search: '', referrer: '', pageOrigin: 'https://site.test', viewportWidth: 390 };

  it('keeps the five UTM keys and nothing else from the query string', () => {
    const p = landingProps({ ...base, search: '?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=a&utm_term=fx&gclid=ABC&fbclid=Z&email=a@b.co&foo=bar' });
    expect(p).toEqual({ device_class: 'mobile', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring', utm_content: 'a', utm_term: 'fx' });
  });

  it('drops a UTM value that looks like an email instead of losing the whole event', () => {
    expect(landingProps({ ...base, search: '?utm_source=a@b.co&utm_medium=cpc' })).toEqual({ device_class: 'mobile', utm_medium: 'cpc' });
  });

  it('bounds UTM values to 100 characters', () => {
    expect(landingProps({ ...base, search: `?utm_source=${'x'.repeat(300)}` }).utm_source).toHaveLength(100);
  });

  it('reduces the referrer to its ORIGIN (no path, no query)', () => {
    const p = landingProps({ ...base, referrer: 'https://news.example.com/article/42?email=a@b.co&token=secret#frag' });
    expect(p.referrer_origin).toBe('https://news.example.com');
    expect(JSON.stringify(p)).not.toContain('secret');
  });

  it('omits an internal, empty or unparseable referrer', () => {
    for (const referrer of ['', 'https://site.test/pricing', 'not a url', 'about:blank']) {
      expect(landingProps({ ...base, referrer })).not.toHaveProperty('referrer_origin');
    }
  });

  it.each([[375, 'mobile'], [767, 'mobile'], [768, 'tablet'], [1023, 'tablet'], [1024, 'desktop'], [1920, 'desktop']])('width %i → %s', (viewportWidth, expected) => {
    expect(landingProps({ ...base, viewportWidth }).device_class).toBe(expected);
  });
});

/* ---------- client tracker ---------- */
function tracker(overrides: Partial<TrackerConfig> = {}) {
  const sent: { url: string; body: { api_key: string; batch: { event: string; distinct_id: string; properties: Record<string, unknown> }[] }; unload: boolean }[] = [];
  let pending: (() => void) | undefined;
  const t = createTracker({
    key: 'phc_test',
    host: 'https://ph.test',
    env: 'test',
    cookies: () => `fxr_vid=${VID}; fxr_variant=email_only`,
    transport: (url, body, unload) => sent.push({ url, body: JSON.parse(body), unload }),
    schedule: (flush) => (pending = flush),
    consent: () => true,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
  return { t, sent, runScheduled: () => pending?.() };
}

describe('client tracker', () => {
  it('queues, then sends ONE batch in order to /batch/ with the project key', () => {
    const { t, sent, runScheduled } = tracker();
    t.track('landing_viewed', { device_class: 'desktop' });
    t.track('signup_started', { fields_shown: ['email'] });
    t.track('signup_submitted', { attempt: 1, name_provided: false });
    expect(sent).toHaveLength(0); // nothing leaves until the idle callback
    runScheduled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://ph.test/batch/');
    expect(sent[0]!.body.api_key).toBe('phc_test');
    expect((sent[0]!.body as unknown as { sent_at: string }).sent_at).toBe('2026-01-01T00:00:00.000Z'); // clock-skew correction
    expect(sent[0]!.body.batch.map((e) => e.event)).toEqual(['landing_viewed', 'signup_started', 'signup_submitted']);
  });

  it('attaches context after the event properties (an event cannot override it) and stays anonymous', () => {
    const { t, sent, runScheduled } = tracker();
    t.track('landing_viewed', { device_class: 'mobile' });
    runScheduled();
    const [event] = sent[0]!.body.batch;
    expect(event!.distinct_id).toBe(VID);
    expect(event!.properties).toMatchObject({ experiment: 'signup_fields', variant: 'email_only', env: 'test', $lib: 'fxr-web', $process_person_profile: false, device_class: 'mobile' });
  });

  it('GPC / consent denied ⇒ nothing is queued or sent', () => {
    const { t, sent, runScheduled } = tracker({ consent: () => false });
    t.track('landing_viewed', { device_class: 'mobile' });
    runScheduled();
    t.flush(true);
    expect(sent).toHaveLength(0);
  });

  it('consent withdrawn while events are queued ⇒ the queue is dropped, not sent', () => {
    let allowed = true;
    const { t, sent } = tracker({ consent: () => allowed });
    t.track('landing_viewed', { device_class: 'mobile' });
    allowed = false;
    t.flush();
    expect(sent).toHaveLength(0);
  });

  it('no project key ⇒ a clean no-op', () => {
    const { t, sent, runScheduled } = tracker({ key: undefined });
    t.track('landing_viewed', { device_class: 'mobile' });
    runScheduled();
    expect(sent).toHaveLength(0);
  });

  it('track() returns true only when the event was queued (so once-guards are not consumed by refused calls)', () => {
    expect(tracker().t.track('landing_viewed', { device_class: 'mobile' })).toBe(true);
    expect(tracker({ consent: () => false }).t.track('landing_viewed', { device_class: 'mobile' })).toBe(false);
    expect(tracker({ key: undefined }).t.track('landing_viewed', { device_class: 'mobile' })).toBe(false);
    expect(tracker({ cookies: () => '' }).t.track('landing_viewed', { device_class: 'mobile' })).toBe(false);
  });

  it.each([['not a uuid', 'fxr_vid=hello'], ['an email', 'fxr_vid=a@b.co'], ['empty', 'fxr_vid=']])(
    'a tampered visitor-id cookie (%s) ⇒ nothing is sent, the value never becomes a distinct_id',
    (_l, cookies) => {
      const { t, sent, runScheduled } = tracker({ cookies: () => cookies });
      expect(t.track('landing_viewed', { device_class: 'mobile' })).toBe(false);
      runScheduled();
      expect(sent).toHaveLength(0);
    },
  );

  it('no visitor-id cookie ⇒ nothing is sent (there is nothing to join on)', () => {
    const { t, sent, runScheduled } = tracker({ cookies: () => '' });
    t.track('landing_viewed', { device_class: 'mobile' });
    runScheduled();
    expect(sent).toHaveLength(0);
  });

  it('a missing or tampered variant cookie is reported as "unattributed"', () => {
    for (const cookies of [`fxr_vid=${VID}`, `fxr_vid=${VID}; fxr_variant=hacked`]) {
      const { t, sent, runScheduled } = tracker({ cookies: () => cookies });
      t.track('landing_viewed', { device_class: 'mobile' });
      runScheduled();
      expect(sent[0]!.body.batch[0]!.properties.variant).toBe('unattributed');
    }
  });

  it('flush(true) (pagehide) marks the send as an unload send and an empty queue sends nothing', () => {
    const { t, sent } = tracker();
    t.flush(true);
    expect(sent).toHaveLength(0);
    t.track('signup_started', { fields_shown: ['email'] });
    t.flush(true);
    expect(sent[0]!.unload).toBe(true);
  });

  it('a PII violation throws in test env (so it is caught immediately) and sends nothing', () => {
    const { t, sent } = tracker();
    expect(() => t.track('signup_started', { fields_shown: ['a@b.co'] as never })).toThrow(AnalyticsViolation);
    expect(sent).toHaveLength(0);
  });

  it('in production a PII violation is dropped silently-with-warning and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { t, sent, runScheduled } = tracker({ env: 'prod' });
    expect(() => t.track('signup_started', { fields_shown: ['a@b.co'] as never })).not.toThrow();
    runScheduled();
    expect(sent).toHaveLength(0);
    warn.mockRestore();
  });
});

/* ---------- consent signal ---------- */
describe('Global Privacy Control', () => {
  it.each([[true, true], ['1', true], [1, true], [false, false], [undefined, false], ['0', false], [null, false]])('%s → opted out: %s', (value, expected) => {
    expect(gpcOptedOut(value)).toBe(expected);
  });
});

/* ---------- server emitter ---------- */
function server(overrides: Partial<Parameters<typeof createServerAnalytics>[0]> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const deferred: Promise<unknown>[] = [];
  const fetchStub = vi.fn<typeof fetch>(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response('{}', { status: 200 });
  });
  const analytics = createServerAnalytics({
    key: 'phc_test',
    host: 'https://ph.test',
    env: 'test',
    fetch: fetchStub,
    defer: (p) => deferred.push(p),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
  const req = (headers: Record<string, string> = {}) => new Request('http://x/api/users', { method: 'POST', headers });
  return { analytics, calls, deferred, req, fetchStub };
}
const succeeded = { name: 'signup_succeeded', props: { user_id: 'user-1', name_provided: false } } as const;
const failed = { name: 'signup_failed', props: { source: 'server', error_code: 'email_taken', retryable: false } } as const;

describe('server analytics emitter', () => {
  it('posts the conversion to /i/v0/e/ with user_id, $insert_id, cookie variant and visitor id; response is not awaited (deferred)', async () => {
    const { analytics, calls, deferred, req } = server();
    analytics.capture(succeeded, req({ 'x-visitor-id': VID, cookie: 'fxr_variant=control; other=1' }));
    expect(deferred).toHaveLength(1); // handed to defer(): the 201 does not wait for it
    await Promise.all(deferred);
    expect(calls[0]!.url).toBe('https://ph.test/i/v0/e/');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({
      api_key: 'phc_test',
      event: 'signup_succeeded',
      distinct_id: VID,
      properties: { user_id: 'user-1', name_provided: false, variant: 'control', experiment: 'signup_fields', env: 'test', $lib: 'fxr-server', $insert_id: 'user-1', $process_person_profile: false },
    });
  });

  it('Sec-GPC: 1 ⇒ nothing is sent', async () => {
    const { analytics, calls, deferred, req } = server();
    analytics.capture(succeeded, req({ 'x-visitor-id': VID, 'sec-gpc': '1' }));
    await Promise.all(deferred);
    expect(calls).toHaveLength(0);
  });

  it('no key ⇒ nothing is sent', () => {
    const { analytics, deferred, req } = server({ key: undefined });
    analytics.capture(succeeded, req({ 'x-visitor-id': VID }));
    expect(deferred).toHaveLength(0);
  });

  it('no visitor id: the conversion is still counted (under the user id, variant "unattributed"); a failure is skipped', async () => {
    const { analytics, calls, deferred, req } = server();
    analytics.capture(succeeded, req());
    analytics.capture(failed, req());
    await Promise.all(deferred);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ distinct_id: 'user-1', properties: { variant: 'unattributed' } });
  });

  it('a malformed X-Visitor-Id is treated as absent (never trusted, never an error)', async () => {
    const { analytics, calls, deferred, req } = server();
    analytics.capture(failed, req({ 'x-visitor-id': 'a@b.co' }));
    await Promise.all(deferred);
    expect(calls).toHaveLength(0);
  });

  it('a tampered variant cookie is reported as "unattributed"', async () => {
    const { analytics, calls, deferred, req } = server();
    analytics.capture(failed, req({ 'x-visitor-id': VID, cookie: 'fxr_variant=hacked' }));
    await Promise.all(deferred);
    expect(JSON.parse(calls[0]!.init.body as string).properties.variant).toBe('unattributed');
  });

  it('never throws and never rejects when PostHog is down or slow (logs the error name only, not the payload)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = server({ fetch: vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed: https://ph.test key=phc_test'); }) });
    down.analytics.capture(succeeded, down.req({ 'x-visitor-id': VID }));
    await expect(Promise.all(down.deferred)).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledWith('analytics: capture failed', 'TypeError');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('phc_test');

    const rejected = server({ fetch: vi.fn<typeof fetch>(async () => new Response('no', { status: 401 })) });
    rejected.analytics.capture(succeeded, rejected.req({ 'x-visitor-id': VID }));
    await Promise.all(rejected.deferred);
    expect(warn).toHaveBeenCalledWith('analytics: capture rejected (401)');
    warn.mockRestore();
  });

  it('a PII violation throws in test env and drops in production', () => {
    const bad = { name: 'signup_succeeded', props: { user_id: 'a@b.co', name_provided: false } } as const;
    expect(() => server().analytics.capture(bad, server().req({ 'x-visitor-id': VID }))).toThrow(AnalyticsViolation);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prod = server({ env: 'prod' });
    prod.analytics.capture(bad, prod.req({ 'x-visitor-id': VID }));
    expect(prod.deferred).toHaveLength(0);
    warn.mockRestore();
  });
});

describe('defer', () => {
  it('works off Vercel (no request context): never throws, the promise still runs', async () => {
    let ran = false;
    expect(() => defer(Promise.resolve().then(() => (ran = true)))).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toBe(true);
  });
});
