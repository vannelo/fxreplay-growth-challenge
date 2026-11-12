import { expect, test } from '@playwright/test';
import {
  assignArm,
  created,
  emailInput,
  expectNoAxeViolations,
  fulfillJson,
  interceptSignup,
  liveRegion,
  openLanding,
  submitButton,
  uniqueEmail,
} from './helpers';

test.describe('signup states', () => {
  test('idle: labelled fields, enabled after hydration, no announcement, no axe violations', async ({ page }) => {
    await openLanding(page);
    await expect(emailInput(page)).toHaveAttribute('type', 'email');
    await expect(emailInput(page)).toHaveAttribute('autocomplete', 'email');
    await expect(submitButton(page)).toHaveText('Try FX Replay Free');
    await expect(liveRegion(page)).toHaveText('');
    await expectNoAxeViolations(page);
  });

  test('fieldError: invalid email → inline error linked by aria-describedby, focus moves to it, announced, input kept', async ({ page }) => {
    await openLanding(page);
    await emailInput(page).fill('not-an-email');
    await submitButton(page).click();

    const error = page.locator('#signup-email-error');
    await expect(error).toHaveText('Enter a valid email address');
    await expect(emailInput(page)).toBeFocused();
    await expect(emailInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(emailInput(page)).toHaveAttribute('aria-describedby', 'signup-email-error');
    await expect(emailInput(page)).toHaveValue('not-an-email');
    await expect(liveRegion(page)).toHaveText('1 field needs attention.');
    await expectNoAxeViolations(page);
  });

  test('fieldError: empty submit, then fixing the field clears the error', async ({ page }) => {
    await openLanding(page);
    await submitButton(page).click();
    await expect(page.locator('#signup-email-error')).toBeVisible();
    await emailInput(page).fill('ok@example.com');
    await expect(page.locator('#signup-email-error')).toHaveCount(0);
    await expect(emailInput(page)).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('submitting: busy state, read-only inputs, announced, a second click sends no second request', async ({ page }) => {
    await openLanding(page);
    const attempts = await interceptSignup(page, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await created(route);
    });
    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).click();

    await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(submitButton(page)).toHaveText('Creating account…');
    await expect(submitButton(page)).toBeFocused(); // aria-disabled, not disabled: focus is not dropped
    await expect(emailInput(page)).toHaveJSProperty('readOnly', true);
    await expect(liveRegion(page)).toHaveText('Creating your account…');
    await submitButton(page).click({ force: true });
    await submitButton(page).press('Enter');
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    expect(attempts).toHaveLength(1);
  });

  test('success (real API): conversion state, focus on the confirmation, announced, no redirect', async ({ page }) => {
    await openLanding(page);
    await emailInput(page).fill(uniqueEmail());
    await page.getByLabel('Name (optional)').fill('Ada Lovelace');
    await submitButton(page).click();

    const heading = page.getByRole('heading', { name: 'Account created' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(liveRegion(page)).toHaveText('Account created.');
    expect(new URL(page.url()).pathname).toBe('/');
    await expectNoAxeViolations(page);
  });

  test('email_only arm creates an account from the email alone', async ({ page, request }) => {
    await openLanding(page, 'email_only');
    const email = uniqueEmail();
    await emailInput(page).fill(email);
    await submitButton(page).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    const list = await (await request.get('/api/users?limit=100')).json();
    expect(list.data.find((u: { email: string }) => u.email === email)?.name).toBeNull();
  });

  test('sends the visitor id header from the first-party cookie', async ({ page }) => {
    await openLanding(page);
    const attempts = await interceptSignup(page, created);
    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    const cookies = await page.context().cookies();
    expect(attempts[0]!.visitor).toBe(cookies.find((c) => c.name === 'fxr_vid')!.value);
  });
});

test.describe('server and network failures', () => {
  test('409 (real API): helpful message, email flagged and focused, input kept, a changed email gets a NEW Idempotency-Key', async ({ page, request }) => {
    const taken = uniqueEmail();
    expect((await request.post('/api/users', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { email: taken } })).status()).toBe(201);

    await openLanding(page);
    const seen: (string | undefined)[] = [];
    page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/users') && seen.push(r.headers()['idempotency-key']));

    await emailInput(page).fill(taken);
    await submitButton(page).click();
    const message = page.locator('#signup-email-error');
    await expect(message).toContainText('This email already has an account. Sign in instead, or use a different email.');
    await expect(message.getByRole('link')).toHaveCount(0); // PUBLIC_SIGNIN_URL is not set in e2e: plain text, never a fake link
    await expect(emailInput(page)).toBeFocused();
    await expect(emailInput(page)).toHaveValue(taken);
    await expect(liveRegion(page)).toContainText('already has an account');
    await expectNoAxeViolations(page);

    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]); // no 422 idempotency_key_reuse after editing the payload
  });

  test('409 then resubmitting the same email sends a NEW key (a definitive 4xx never reuses one)', async ({ page, request }) => {
    const taken = uniqueEmail();
    await request.post('/api/users', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { email: taken } });
    await openLanding(page);
    const attempts = await interceptSignup(page, (route) => fulfillJson(route, 409, { error: { code: 'email_taken', message: 'x' } }));
    await emailInput(page).fill(taken);
    await submitButton(page).click();
    await expect(page.locator('#signup-email-error')).toBeVisible();
    await submitButton(page).click();
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[1]!.key).not.toBe(attempts[0]!.key);
  });

  test('500: message, "Try again", input kept; the retry reuses the SAME key and body, then succeeds', async ({ page }) => {
    await openLanding(page);
    const attempts = await interceptSignup(page, (route, n) =>
      n === 1 ? fulfillJson(route, 500, { error: { code: 'internal_error', message: 'x' } }) : created(route),
    );
    const email = uniqueEmail();
    await emailInput(page).fill(email);
    await submitButton(page).click();

    await expect(page.locator('#signup form').getByText('Something went wrong on our side. Please try again.')).toBeVisible();
    await expect(submitButton(page)).toHaveText('Try again');
    await expect(emailInput(page)).toHaveValue(email);
    await expect(liveRegion(page)).toHaveText('Something went wrong on our side. Please try again.');
    await expectNoAxeViolations(page);

    await submitButton(page).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.key).toBe(attempts[0]!.key);
    expect(attempts[1]!.body).toEqual(attempts[0]!.body);
  });

  test('429: retryable, honours Retry-After, retry reuses the same key', async ({ page }) => {
    await openLanding(page);
    const attempts = await interceptSignup(page, (route, n) =>
      n === 1 ? fulfillJson(route, 429, { error: { code: 'rate_limited', message: 'x' } }, { 'Retry-After': '5' }) : created(route),
    );
    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).click();
    await expect(page.locator('#signup form').getByText('Too many attempts. Please wait 5 seconds and try again.')).toBeVisible();
    await expect(submitButton(page)).toHaveText('Try again');
    await submitButton(page).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    expect(attempts[1]!.key).toBe(attempts[0]!.key);
  });

  test('network error: message, retry affordance, same key and body on retry', async ({ page }) => {
    await openLanding(page);
    const attempts = await interceptSignup(page, (route, n) => (n === 1 ? route.abort('failed') : created(route)));
    const email = uniqueEmail();
    await emailInput(page).fill(email);
    await submitButton(page).click();

    await expect(page.locator('#signup form').getByText('Connection problem. Check your connection and try again.')).toBeVisible();
    await expect(submitButton(page)).toHaveText('Try again');
    await expect(emailInput(page)).toHaveValue(email);
    await expect(liveRegion(page)).toHaveText('Connection problem. Check your connection and try again.');
    await expectNoAxeViolations(page);

    await submitButton(page).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
    expect(attempts[1]!.key).toBe(attempts[0]!.key);
    expect(attempts[1]!.body).toEqual(attempts[0]!.body);
  });

  test('a server 422 with a field error is shown inline on that field', async ({ page }) => {
    await openLanding(page);
    await interceptSignup(page, (route) =>
      fulfillJson(route, 422, { error: { code: 'validation_error', message: 'x', fields: { email: ['Enter a valid email address'] } } }),
    );
    await emailInput(page).fill('looks-valid@example.com');
    await submitButton(page).click();
    await expect(page.locator('#signup-email-error')).toHaveText('Enter a valid email address');
    await expect(emailInput(page)).toBeFocused();
  });
});

test('text typed BEFORE the island hydrates is kept and submittable (regression: a controlled input wiped it)', async ({ page }) => {
  // Hold the island script back so the page is interactive-looking but not hydrated.
  await page.route('**/_astro/SignupForm*.js', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const email = uniqueEmail();
  await assignArm(page, 'control'); // the name field only exists in the control arm
  await page.goto('/');
  await expect(submitButton(page)).toBeDisabled(); // not hydrated yet
  await emailInput(page).fill(email);
  await page.getByLabel('Name (optional)').fill('Early Typer');

  await expect(submitButton(page)).toBeEnabled({ timeout: 10_000 }); // hydrated now
  await expect(emailInput(page)).toHaveValue(email);
  await expect(page.getByLabel('Name (optional)')).toHaveValue('Early Typer');
  await submitButton(page).click();
  await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
});

test('keyboard only: Tab through the fields and submit with Enter', async ({ page }) => {
  await openLanding(page);
  await emailInput(page).focus();
  await page.keyboard.type(uniqueEmail());
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Name (optional)')).toBeFocused();
  await page.keyboard.type('Keyboard User');
  await page.keyboard.press('Tab');
  await expect(submitButton(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Account created' })).toBeFocused();
});

test.describe('accessibility regressions (from the a11y audit; each verified red before the fix)', () => {
  test('submitting the SAME invalid form again moves focus back to the field and re-announces', async ({ page }) => {
    await openLanding(page);
    await emailInput(page).fill('nope');
    await submitButton(page).click();
    await expect(emailInput(page)).toBeFocused();

    // Keyboard user tabs to the button and submits again without changing anything.
    await page.keyboard.press('Tab'); // → name
    await page.keyboard.press('Tab'); // → submit
    await expect(submitButton(page)).toBeFocused();

    const mutations = await page.evaluate(() => {
      const region = document.querySelector('#signup [role="status"]')!;
      (window as unknown as { __live: number }).__live = 0;
      new MutationObserver(() => ((window as unknown as { __live: number }).__live += 1)).observe(region, { childList: true, characterData: true, subtree: true });
      return 0;
    });
    expect(mutations).toBe(0);
    await page.keyboard.press('Enter');
    await expect(emailInput(page)).toBeFocused(); // focus returns to the invalid field on EVERY failed attempt
    await expect.poll(() => page.evaluate(() => (window as unknown as { __live: number }).__live)).toBeGreaterThan(0); // the live region was touched again
  });

  test('reflows at 320 CSS px (400% zoom equivalent): no horizontal scroll in any arm', async ({ page }) => {
    for (const arm of ['control', 'email_only'] as const) {
      await page.context().clearCookies();
      await openLanding(page, arm);
      await page.setViewportSize({ width: 320, height: 640 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, arm).toBeLessThanOrEqual(0);
    }
  });

  test('interactive targets are at least 24x24 CSS px (WCAG 2.5.8)', async ({ page }) => {
    await openLanding(page);
    const undersized = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('a[href], button, input')]
        .filter((el) => !el.closest('.sr-only') && getComputedStyle(el).display !== 'none')
        .map((el) => ({ el: el.tagName + (el.id ? '#' + el.id : '') + ' ' + (el.textContent ?? '').trim().slice(0, 20), ...el.getBoundingClientRect().toJSON() }))
        .filter((r) => r.width < 24 || r.height < 24)
        .map((r) => `${r.el}: ${Math.round(r.width)}x${Math.round(r.height)}`),
    );
    expect(undersized).toEqual([]);
  });

  test('busy and read-only states keep their contrast: no opacity dimming on the button text or field borders', async ({ page }) => {
    await openLanding(page);
    await interceptSignup(page, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await created(route);
    });
    await emailInput(page).fill(uniqueEmail());
    await submitButton(page).click();
    await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true');
    const opacity = await page.evaluate(() => ({
      button: getComputedStyle(document.querySelector('#signup button[type="submit"]')!).opacity,
      email: getComputedStyle(document.querySelector('#signup-email')!).opacity,
    }));
    expect(opacity).toEqual({ button: '1', email: '1' });
  });
});
