import { UUID_PATTERN, isVariant } from '../lib/experiment';
import { readCookie } from '../lib/cookies';
import { looksLikeEmail, sanitize, type AppEnv, type ClientEventName, type EventMap } from './events';
import { buildEvent, gpcOptedOut, type CaptureEvent, type EventContext } from './payload';

export interface TrackerConfig {
  /** PostHog project API key. Absent ⇒ analytics is a clean no-op. */
  key: string | undefined;
  host: string;
  env: AppEnv;
  /** Cookie string to read the visitor id / variant from (`document.cookie`). */
  cookies: () => string;
  /** Sends one JSON body. `unload` = the page is going away (use sendBeacon). */
  transport: (url: string, body: string, unload: boolean) => void;
  /** Schedules a flush off the critical path (idle callback). */
  schedule: (flush: () => void) => void;
  /** true = allowed to send. Defaults to the Global Privacy Control check; a CMP can replace it. */
  consent: () => boolean;
  now?: () => Date;
}

export function createTracker(config: TrackerConfig) {
  const queue: CaptureEvent[] = [];
  let scheduled = false;
  const strict = config.env === 'dev' || config.env === 'test';

  function context(): EventContext | null {
    const distinctId = readCookie('fxr_vid', config.cookies());
    // No (or a tampered) visitor id: nothing to join on, send nothing. The id must be the UUID middleware set,
    // never something a script or extension wrote into the cookie (audit finding).
    if (!distinctId || !UUID_PATTERN.test(distinctId) || looksLikeEmail(distinctId)) return null;
    const variant = readCookie('fxr_variant', config.cookies());
    return { distinctId, variant: isVariant(variant) ? variant : 'unattributed', env: config.env };
  }

  function flush(unload = false) {
    scheduled = false;
    if (queue.length === 0) return;
    const batch = queue.splice(0);
    if (!config.consent()) return; // consent withdrawn while queued: drop, do not send
    // sent_at lets PostHog correct client clock skew (`timestamp` is adjusted by server time − sent_at; PostHog docs).
    const sentAt = (config.now ?? (() => new Date()))().toISOString();
    config.transport(`${config.host}/batch/`, JSON.stringify({ api_key: config.key, sent_at: sentAt, batch }), unload);
  }

  /**
   * Typed: only client events, each with exactly its registry properties.
   * Returns true only if the event was queued, so "once per page view" guards are consumed only by a real send,
   * not by a call that consent (or a missing id) refused (audit finding: a later grant must not lose the entry event).
   */
  function track<K extends ClientEventName>(name: K, props: EventMap[K]): boolean {
    if (!config.key || !config.consent()) return false;
    const clean = sanitize(name, props, strict);
    const ctx = context();
    if (!clean || !ctx) return false;
    queue.push(buildEvent(name, clean, ctx, 'fxr-web', (config.now ?? (() => new Date()))()));
    if (!scheduled) {
      scheduled = true;
      config.schedule(() => flush());
    }
    return true;
  }

  return { track, flush };
}

export type Tracker = ReturnType<typeof createTracker>;
export { gpcOptedOut };
