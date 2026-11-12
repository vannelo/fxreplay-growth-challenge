/**
 * Lab measurement of the CURRENT production build (ADR-006): time-to-interactive form, LCP, TBT, worst interaction,
 * and whether text typed before hydration survives. The client:load vs client:idle comparison that chose the
 * directive is recorded in docs/measurements/ (the temporary switch it needed was removed once the owner decided).
 * Usage: E2E=1 npx astro build && node scripts/measure-hydration.mjs [runs=15] [out=docs/measurements/hydration.json]
 * Profile = Lighthouse's mobile simulation: Pixel 7 viewport, 4x CPU slowdown, 1.6 Mbps down / 750 Kbps up / 150 ms RTT.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const RUNS = Number(process.argv[2] ?? 15);
const PORT = 4411;
const TYPED = 'early@example.com';

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  const round = (x) => Math.round(x * 10) / 10;
  return { median: round(at(0.5)), p75: round(at(0.75)), max: round(s.at(-1)), min: round(s[0]) };
};

const collector = () => {
  const m = { longtasks: [], events: [], lcp: 0, interactiveAt: 0 };
  window.__m = m;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => m.longtasks.push({ start: e.startTime, duration: e.duration }))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => m.events.push({ duration: e.duration, interactionId: e.interactionId }))).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (m.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
  // "Interactive" = the moment the server-rendered, disabled submit button is enabled by the hydrated island.
  new MutationObserver(() => {
    const button = document.querySelector('#signup form button[type="submit"]');
    if (button && !button.disabled && !m.interactiveAt) m.interactiveAt = performance.now();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
};

async function oneRun(browser) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.addInitScript(collector);
  await page.route('**/api/users', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: '{"data":{}}' }));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // Early interaction: type as soon as the server HTML's form exists (before hydration).
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'commit' });
  await page.waitForSelector('#signup-email');
  await page.locator('#signup-email').tap();
  await page.keyboard.type(TYPED, { delay: 15 });
  await page.waitForFunction(() => window.__m.interactiveAt > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => window.__m);
  const kept = (await page.locator('#signup-email').inputValue()) === TYPED;
  await context.close();
  const interactions = m.events.filter((e) => e.interactionId > 0);
  return {
    interactiveAt: m.interactiveAt,
    lcp: m.lcp,
    tbt5s: m.longtasks.filter((t) => t.start < 5000).reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0),
    worstInteraction: interactions.length ? Math.max(...interactions.map((e) => e.duration)) : 0,
    typedTextKept: kept,
  };
}

const server = spawn('node', ['dist/server/entry.mjs'], { env: { ...process.env, PORT: String(PORT), HOST: 'localhost' }, stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await oneRun(browser));
  await browser.close();
  const col = (k) => runs.map((r) => r[k]);
  const out = {
    profile: 'Pixel 7, 4x CPU, 1.6Mbps/750Kbps/150ms RTT (Lighthouse mobile)',
    directive: 'client:load',
    runs: RUNS,
    when: new Date().toISOString(),
    interactiveAtMs: stats(col('interactiveAt')),
    lcpMs: stats(col('lcp')),
    tbt5sMs: stats(col('tbt5s')),
    worstInteractionMs: stats(col('worstInteraction')),
    runsTypedTextLost: runs.filter((r) => !r.typedTextKept).length,
    raw: runs,
  };
  const file = process.argv[3] ?? 'docs/measurements/hydration.json';
  writeFileSync(file, JSON.stringify(out, null, 2));
  const { raw, ...summary } = out;
  console.log(JSON.stringify(summary, null, 1));
  console.log(`written: ${file}`);
} finally {
  server.kill();
}
