import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Route } from '@playwright/test';
import { ORIGIN } from './constants';

export type Arm = 'control' | 'email_only';

export const uniqueEmail = () => `e2e-${crypto.randomUUID()}@example.com`;

/** Make this browser context a visitor already assigned to `arm` (otherwise the arm is random). */
export async function assignArm(page: Page, arm: Arm): Promise<string> {
  const vid = crypto.randomUUID();
  await page.context().addCookies([
    { name: 'fxr_vid', value: vid, url: ORIGIN },
    { name: 'fxr_variant', value: arm, url: ORIGIN },
  ]);
  return vid;
}

/** Open the landing page as a visitor assigned to `arm`, and wait until the island is hydrated. */
export async function openLanding(page: Page, arm: Arm = 'control', query = ''): Promise<string> {
  const vid = await assignArm(page, arm);
  await page.goto(`/${query}`);
  await expect(submitButton(page)).toBeEnabled(); // enabled only once hydrated
  return vid;
}

export const submitButton = (page: Page) => page.locator('#signup form button[type="submit"]');
export const liveRegion = (page: Page) => page.locator('#signup [role="status"]');
export const emailInput = (page: Page) => page.getByLabel('Email', { exact: true });

/** Intercept POST /api/users and record the headers/body of every attempt. */
export async function interceptSignup(page: Page, respond: (route: Route, attempt: number) => Promise<void>) {
  const attempts: { key: string | undefined; visitor: string | undefined; body: unknown }[] = [];
  await page.route('**/api/users', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts.push({
      key: route.request().headers()['idempotency-key'],
      visitor: route.request().headers()['x-visitor-id'],
      body: route.request().postDataJSON(),
    });
    await respond(route, attempts.length);
  });
  return attempts;
}

export const fulfillJson = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

export const created = (route: Route) =>
  fulfillJson(route, 201, {
    data: {
      id: crypto.randomUUID(),
      email: 'x@example.com',
      name: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

/** WCAG 2.2 A/AA automated pass. Automation finds only part of the problems: it never proves a page is accessible. */
export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}
