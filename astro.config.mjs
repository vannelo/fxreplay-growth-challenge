import { defineConfig, envField, fontProviders } from 'astro/config';
import preact from '@astrojs/preact';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// `astro preview` does not run with the Vercel adapter (ADR-008), so e2e builds (E2E=1) use the Node adapter and run
// the production server output. Deploys use Vercel.
const e2e = process.env.E2E === '1';

// The landing page is rendered on demand so middleware can assign the experiment variant (ADR-004); /api/* likewise.
export default defineConfig({
  adapter: e2e ? node({ mode: 'standalone' }) : vercel(),
  integrations: [preact()],
  vite: { plugins: [tailwindcss()] },
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
    },
  },
});
