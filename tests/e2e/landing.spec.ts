import { expect, test } from '@playwright/test';
import { emailInput, openLanding } from './helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('page structure', () => {
  test('one h1, landmarks, skip link, language and title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('Try FX Replay Free');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('FX Replay is free to try.');
    for (const landmark of ['banner', 'main', 'contentinfo']) await expect(page.getByRole(landmark as 'main')).toHaveCount(1);

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the submit button ships disabled in the server HTML (no native submit before hydration)', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  test('the final CTA is a link to the single signup form, not a second form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Try FX Replay Free' })).toHaveAttribute('href', '#signup');
    await expect(page.locator('form')).toHaveCount(1);
  });
});

test.describe('experiment cookies and variant rendering (ADR-004 / ADR-007)', () => {
  test('first visit sets a visitor id and a variant: JS-readable, Lax, ~90 days; the page is not cacheable', async ({ page, context }) => {
    const response = await page.goto('/');
    expect(response?.headers()['cache-control']).toBe('private, no-store');
    const cookies = await context.cookies();
    const vid = cookies.find((c) => c.name === 'fxr_vid');
    const variant = cookies.find((c) => c.name === 'fxr_variant');
    expect(vid?.value).toMatch(UUID);
    expect(['control', 'email_only']).toContain(variant?.value);
    for (const c of [vid!, variant!]) {
      expect(c.httpOnly).toBe(false);
      expect(c.sameSite).toBe('Lax');
      const days = (c.expires - Date.now() / 1000) / 86400;
      expect(days).toBeGreaterThan(89);
      expect(days).toBeLessThanOrEqual(90);
    }
  });

  test('the variant is sticky: a reload keeps both cookies and sends no new Set-Cookie', async ({ page, context }) => {
    await page.goto('/');
    const before = await context.cookies();
    const reload = await page.reload();
    expect(reload?.headers()['set-cookie']).toBeUndefined();
    expect(await context.cookies()).toEqual(before);
  });

  test('a tampered variant or visitor id is replaced, not trusted', async ({ page, context, baseURL }) => {
    const host = new URL(baseURL!).hostname;
    await context.addCookies([
      { name: 'fxr_vid', value: 'not-a-uuid', domain: host, path: '/' },
      { name: 'fxr_variant', value: 'hacked', domain: host, path: '/' },
    ]);
    await page.goto('/');
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'fxr_vid')?.value).toMatch(UUID);
    expect(['control', 'email_only']).toContain(cookies.find((c) => c.name === 'fxr_variant')?.value);
  });

  test('control renders the optional name field; email_only does not', async ({ page }) => {
    await openLanding(page, 'control');
    await expect(page.getByLabel('Name (optional)')).toBeVisible();
    await expect(emailInput(page)).toBeVisible();
    await page.context().clearCookies();

    await openLanding(page, 'email_only');
    await expect(page.getByLabel(/^Name/)).toHaveCount(0);
    await expect(emailInput(page)).toBeVisible();
  });

  test('the API is not touched by the landing-page middleware (no cookies, no page caching header)', async ({ request }) => {
    const res = await request.get('/api/users');
    expect(res.status()).toBe(200);
    expect(res.headers()['set-cookie']).toBeUndefined();
    expect(res.headers()['cache-control']).not.toBe('private, no-store');
  });
});

test.describe('cross-origin posture (Node-adapter build; Vercel needs its own deployed check, ADR-008)', () => {
  test('a cross-origin preflight is never approved: no Access-Control-Allow-Origin', async ({ request }) => {
    const res = await request.fetch('/api/users', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('a cross-origin form-style POST is blocked by Astro\'s origin check (403); the same-origin one reaches us and gets 415', async ({ request, baseURL }) => {
    const form = { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': crypto.randomUUID() };
    const crossOrigin = await request.post('/api/users', { headers: { ...form, Origin: 'https://evil.example' }, data: 'email=a@b.co' });
    expect(crossOrigin.status()).toBe(403);
    const sameOrigin = await request.post('/api/users', { headers: { ...form, Origin: baseURL! }, data: 'email=a@b.co' });
    expect(sameOrigin.status()).toBe(415);
  });
});

test.describe('fonts, forced colours, CSP and page headers (from the perf and a11y audits)', () => {
  test('body text really uses the self-hosted Nunito Sans and headings use Lato (was: body silently fell back to system fonts)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      h1: getComputedStyle(document.querySelector('h1')!).fontFamily,
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`),
    }));
    expect(fonts.body).toMatch(/^"?Nunito Sans-[0-9a-f]+/); // the Astro-registered face, not a literal family name
    expect(fonts.h1).toMatch(/^"?Lato-[0-9a-f]+/);
    expect(fonts.loaded.some((f) => /^Nunito Sans-[0-9a-f]+ 400$/.test(f))).toBe(true);
    expect(fonts.loaded.some((f) => /^Lato-[0-9a-f]+ 900$/.test(f))).toBe(true);
  });

  test('in forced-colors mode the submit button and the final CTA keep a visible boundary', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/');
    for (const locator of [page.locator('#signup form button[type="submit"]'), page.getByRole('link', { name: 'Try FX Replay Free' })]) {
      const width = await locator.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
      expect(width).toBeGreaterThanOrEqual(1);
    }
  });

  test('a CSP is enforced and nothing on the page violates it through a full signup (hydration, fonts, analytics beacons)', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const vid = crypto.randomUUID();
    await page.context().addCookies([
      { name: 'fxr_vid', value: vid, url: 'http://localhost:4401' },
      { name: 'fxr_variant', value: 'control', url: 'http://localhost:4401' },
    ]);
    const response = await page.goto('/');
    // On an on-demand page Astro sends the CSP as an HTTP header (not a <meta>), with hashes for its own scripts/styles.
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self'( 'sha256-[^']+')+/);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/connect-src 'self' http:\/\/localhost:4410/); // the analytics host, nothing broader
    expect(response?.headers()['x-frame-options']).toBe('DENY');
    await expect(page.locator('#signup form button[type="submit"]')).toBeEnabled(); // the island hydrated under the CSP
    await page.getByLabel('Email', { exact: true }).fill(`csp-${vid}@example.com`);
    await page.locator('#signup form button[type="submit"]').click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    await page.evaluate(() => dispatchEvent(new Event('pagehide'))); // beacon to the analytics host under connect-src
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });

  test('after a successful signup the final CTA (which pointed at the form) is hidden', async ({ page }) => {
    const vid = crypto.randomUUID();
    await page.context().addCookies([
      { name: 'fxr_vid', value: vid, url: 'http://localhost:4401' },
      { name: 'fxr_variant', value: 'email_only', url: 'http://localhost:4401' },
    ]);
    await page.goto('/');
    const cta = page.getByRole('link', { name: 'Try FX Replay Free' });
    await expect(cta).toBeVisible();
    await expect(page.locator('#signup form button[type="submit"]')).toBeEnabled();
    await page.getByLabel('Email', { exact: true }).fill(`cta-${vid}@example.com`);
    await page.locator('#signup form button[type="submit"]').click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    await expect(cta).toBeHidden();
  });
});
