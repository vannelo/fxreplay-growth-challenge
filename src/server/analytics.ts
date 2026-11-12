import { PUBLIC_APP_ENV, PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_KEY } from 'astro:env/client';
import { createServerAnalytics } from '../analytics/server';
import { defer } from '../analytics/defer';

/** Process-wide server emitter for the route modules. A clean no-op until PUBLIC_POSTHOG_KEY is set. */
export const serverAnalytics = createServerAnalytics({ key: PUBLIC_POSTHOG_KEY, host: PUBLIC_POSTHOG_HOST, env: PUBLIC_APP_ENV, defer });
