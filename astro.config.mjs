import { defineConfig } from 'astro/config';

// Adapter (@astrojs/vercel) is added with the deploy step; per-route `prerender = false` on /api/*.
export default defineConfig({});
