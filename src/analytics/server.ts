import { VISITOR_ID_HEADER, VisitorId } from '../contracts/users';
import { isVariant } from '../lib/experiment';
import { readCookie } from '../lib/cookies';
import { sanitize, type AppEnv, type EventMap, type ServerEventName } from './events';
import { buildEvent, gpcOptedOut } from './payload';

export type ServerEvent = { [K in ServerEventName]: { name: K; props: EventMap[K] } }[ServerEventName];

/** What the Users API handlers depend on. Tests inject a recording implementation. */
export interface ServerAnalytics {
  capture(event: ServerEvent, request: Request): void;
}

export const noopAnalytics: ServerAnalytics = { capture() {} };

export interface ServerAnalyticsConfig {
  key: string | undefined;
  host: string;
  env: AppEnv;
  defer: (promise: Promise<unknown>) => void;
  fetch?: typeof fetch;
  now?: () => Date;
}

/**
 * PostHog capture from the server. Best-effort by design: it never throws and never delays the response (the POST runs
 * through `defer`). The visitor id comes from X-Visitor-Id (untrusted, analytics only), the variant from the cookie only.
 */
export function createServerAnalytics(config: ServerAnalyticsConfig): ServerAnalytics {
  const doFetch = config.fetch ?? fetch;
  const strict = config.env === 'dev' || config.env === 'test';

  return {
    capture(event, request) {
      if (!config.key) return;
      if (gpcOptedOut(request.headers.get('sec-gpc'))) return; // consent denied (GPC)

      const visitorId = VisitorId.parse(request.headers.get(VISITOR_ID_HEADER) ?? undefined);
      // Without a visitor id a failure cannot be joined to a visitor: skip it. The conversion is still counted, under the user id.
      const distinctId = visitorId ?? (event.name === 'signup_succeeded' ? event.props.user_id : undefined);
      if (!distinctId) return;

      const clean = sanitize(event.name, event.props, strict);
      if (!clean) return;
      const variantCookie = readCookie('fxr_variant', request.headers.get('cookie') ?? '');
      const body = buildEvent(
        event.name,
        clean,
        { distinctId, variant: isVariant(variantCookie) ? variantCookie : 'unattributed', env: config.env },
        'fxr-server',
        (config.now ?? (() => new Date()))(),
        event.name === 'signup_succeeded' ? event.props.user_id : undefined, // $insert_id: defence in depth, one conversion per user
      );

      config.defer(
        doFetch(`${config.host}/i/v0/e/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: config.key, ...body }),
          signal: AbortSignal.timeout(2000),
        })
          .then((response) => {
            if (!response.ok) console.warn(`analytics: capture rejected (${response.status})`);
          })
          .catch((error: unknown) => console.warn('analytics: capture failed', (error as Error).name)),
      );
    },
  };
}
