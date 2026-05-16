// @ts-check
import { defineConfig } from 'astro/config';

import vercel from '@astrojs/vercel';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://ai-agents-traces.vercel.app',
  output: 'server',
  adapter: vercel(),
  integrations: [
    sitemap({
      changefreq: 'always',
      priority: 1.0,
      lastmod: new Date(),
    }),
  ],
});