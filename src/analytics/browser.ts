/** Browser wiring for the tracker: real cookies, idle scheduling, sendBeacon. Config comes from astro:env (build-time public vars). */
import { PUBLIC_APP_ENV, PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_KEY } from 'astro:env/client';
import { createTracker, gpcOptedOut, type Tracker } from './client';
import type { ClientEventName, EventMap } from './events';

function transport(url: string, body: string, unload: boolean) {
  // text/plain keeps the request "simple" (no CORS preflight); PostHog parses the JSON body regardless (verify with a real key).
  if (unload && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
  void fetch(url, { method: 'POST', body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
}

const schedule = (flush: () => void) =>
  typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(flush, { timeout: 2000 }) : setTimeout(flush, 200);

let tracker: Tracker | undefined;

function instance(): Tracker {
  if (tracker) return tracker;
  tracker = createTracker({
    key: PUBLIC_POSTHOG_KEY,
    host: PUBLIC_POSTHOG_HOST,
    env: PUBLIC_APP_ENV,
    cookies: () => document.cookie,
    transport,
    schedule,
    consent: () => !gpcOptedOut((navigator as Navigator & { globalPrivacyControl?: unknown }).globalPrivacyControl),
  });
  const flushNow = () => tracker?.flush(true);
  addEventListener('pagehide', flushNow);
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushNow());
  // First interaction: send what is queued instead of waiting for idle.
  for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, () => tracker?.flush(), { once: true, passive: true });
  return tracker;
}

export function track<K extends ClientEventName>(name: K, props: EventMap[K]): void {
  instance().track(name, props);
}
