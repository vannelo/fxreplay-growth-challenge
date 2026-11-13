import { defineConfig, envField, fontProviders } from 'astro/config';
import preact from '@astrojs/preact';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// `astro preview` does not run with the Vercel adapter (ADR-008), so e2e builds (E2E=1) use the Node adapter and run
// the production server output. Deploys use Vercel.
const e2e = process.env.E2E === '1';
// connect-src must allow the analytics host the browser beacons to (config cannot read astro:env; process.env is the same value).
const analyticsHost = process.env.PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

// The landing page is rendered on demand so middleware can assign the experiment variant (ADR-004); /api/* likewise.
export default defineConfig({
  adapter: e2e ? node({ mode: 'standalone' }) : vercel(),
  integrations: [preact()],
  vite: { plugins: [tailwindcss()] },
  // Content-Security-Policy: Astro hashes its own scripts/styles (island bootstrap, font CSS); on on-demand pages it sends
  // the policy as a response header (verified with curl; the docs only describe the <meta> form for prerendered pages).
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src 'self' ${analyticsHost}`,
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'", // honoured because Astro sends this CSP as a header on on-demand pages (verified)
      ],
    },
  },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Lato',
      cssVariable: '--font-lato',
      weights: [400, 700, 900],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Helvetica Neue', 'Arial', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Nunito Sans',
      cssVariable: '--font-nunito-sans',
      weights: [400, 600, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['-apple-system', 'Segoe UI', 'sans-serif'],
    },
  ],
  env: {
    schema: {
      // Where the 409 "sign in instead" link points. Unset until the owner supplies it (the UI shows a visible TODO).
      PUBLIC_SIGNIN_URL: envField.string({ context: 'client', access: 'public', optional: true }),
      // Analytics (ADR-003/007). The PostHog project key is public by design. Unset key = analytics is a clean no-op.
      PUBLIC_POSTHOG_KEY: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_POSTHOG_HOST: envField.string({ context: 'client', access: 'public', default: 'https://us.i.posthog.com' }),
      // Postgres connection string (ADR-002). Server-only secret. Unset = in-memory store, which repository.ts refuses in prod/preview.
      DATABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Default 'prod': a deploy that forgets to set it must not tag events as dev nor run the throwing (strict) guard.
      PUBLIC_APP_ENV: envField.enum({ context: 'client', access: 'public', values: ['prod', 'preview', 'dev', 'test'], default: 'prod' }),
    },
  },
});
