/**
 * G2 hydration measurement (ADR-006): client:load vs client:idle for the hero signup island.
 * Usage: E2E=1 npx astro build && node scripts/measure-hydration.mjs [runs=15]
 * Two production servers from the SAME build, differing only in HYDRATE_MODE (read per request by Hero.astro).
 * Profile = Lighthouse's mobile simulation: Pixel 7 viewport, 4x CPU slowdown, 1.6 Mbps down / 750 Kbps up / 150 ms RTT.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const RUNS = Number(process.argv[2] ?? 15);
const PORTS = { idle: 4411, load: 4412 };
const TYPED = 'early@example.com';

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { median: at(0.5), p75: at(0.75), max: s.at(-1), min: s[0] };
};
const round = (x) => Math.round(x * 10) / 10;

function startServer(mode) {
  const child = spawn('node', ['dist/server/entry.mjs'], {
    env: { ...process.env, HYDRATE_MODE: mode, PORT: String(PORTS[mode]), HOST: 'localhost' },
    stdio: 'ignore',
  });
  return child;
}
const waitUp = async (port) => {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server on ${port} did not start`);
};

const collector = () => {
  const m = { longtasks: [], events: [], lcp: 0, pointerdowns: [] };
  window.__m = m;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => m.longtasks.push({ start: e.startTime, duration: e.duration }))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => m.events.push({ name: e.name, start: e.startTime, duration: e.duration, interactionId: e.interactionId })),
  ).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (m.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
  document.addEventListener(
    'pointerdown',
    (e) => {
      const b = e.target?.closest?.('button[type="submit"]');
      if (b) m.pointerdowns.push({ t: performance.now(), disabledAtPress: b.disabled });
    },
    true,
  );
};

async function oneRun(browser, mode) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.addInitScript(collector);
  await page.route('**/api/users', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: { id: crypto.randomUUID(), email: TYPED, name: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
    }),
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // Scripted EARLY interaction: start the moment the server HTML's form exists (before `load`, before hydration).
  await page.goto(`http://localhost:${PORTS[mode]}/`, { waitUntil: 'commit' });
  await page.waitForSelector('#signup-email');
  await page.locator('#signup-email').tap();
  await page.keyboard.type(TYPED, { delay: 15 });
  await page.locator('#signup form button[type="submit"]').tap({ force: true, timeout: 3000 }).catch(() => {});

  await page.waitForFunction(() => performance.getEntriesByName('signup-hydrated').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => ({ ...window.__m, hydratedAt: performance.getEntriesByName('signup-hydrated')[0].startTime }));
  const success = await page.getByRole('heading', { name: 'Account created' }).count();
  const emailValue = success ? TYPED : await page.locator('#signup-email').inputValue();
  await context.close();

  const tbt = m.longtasks.filter((t) => t.start < 5000).reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
  const interactions = m.events.filter((e) => e.interactionId > 0);
  return {
    hydratedAt: m.hydratedAt,
    lcp: m.lcp,
    tbt5s: tbt,
    worstInteraction: interactions.length ? Math.max(...interactions.map((e) => e.duration)) : 0,
    deadPresses: m.pointerdowns.filter((p) => p.disabledAtPress).length,
    pressAt: m.pointerdowns[0]?.t ?? null,
    typedTextKept: emailValue === TYPED,
  };
}

const servers = Object.keys(PORTS).map(startServer);
try {
  await Promise.all(Object.values(PORTS).map(waitUp));
  const browser = await chromium.launch();
  const out = { profile: 'Pixel 7, 4x CPU, 1.6Mbps/750Kbps/150ms RTT (Lighthouse mobile)', runs: RUNS, when: new Date().toISOString(), modes: {} };
  for (const mode of ['idle', 'load']) {
    const results = [];
    for (let i = 0; i < RUNS; i++) results.push(await oneRun(browser, mode));
    const col = (k) => results.map((r) => r[k]);
    out.modes[mode] = {
      hydratedAtMs: Object.fromEntries(Object.entries(stats(col('hydratedAt'))).map(([k, v]) => [k, round(v)])),
      lcpMs: Object.fromEntries(Object.entries(stats(col('lcp'))).map(([k, v]) => [k, round(v)])),
      tbt5sMs: Object.fromEntries(Object.entries(stats(col('tbt5s'))).map(([k, v]) => [k, round(v)])),
      worstInteractionMs: Object.fromEntries(Object.entries(stats(col('worstInteraction'))).map(([k, v]) => [k, round(v)])),
      runsWithDeadPress: results.filter((r) => r.deadPresses > 0).length,
      runsTypedTextLost: results.filter((r) => !r.typedTextKept).length,
      raw: results.map((r) => ({ ...r, hydratedAt: round(r.hydratedAt), lcp: round(r.lcp), tbt5s: round(r.tbt5s), worstInteraction: round(r.worstInteraction) })),
    };
  }
  await browser.close();
  const file = process.argv[3] ?? 'docs/measurements/hydration.json';
  writeFileSync(file, JSON.stringify(out, null, 2));
  for (const [mode, r] of Object.entries(out.modes)) {
    const { raw, ...summary } = r;
    console.log(`\n== ${mode} ==`);
    console.log(JSON.stringify(summary, null, 1));
  }
  console.log(`\nwritten: ${file}`);
} finally {
  servers.forEach((s) => s.kill());
}
