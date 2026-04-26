// @ts-check
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const site = 'https://agent-detective.chapascript.dev';

// https://agent-detective.chapascript.dev/ (merged with Starlight at /docs/ in CI)
export default defineConfig({
  site,
  base: '/',
  trailingSlash: 'always',
  output: 'static',
  build: { assets: 'landing' },
  vite: { plugins: [tailwindcss()] },
  integrations: [
    sitemap({
      // Root `/` is noindex + JS redirect only — do not list in sitemap.
      filter: (page) => {
        try {
          const path = new URL(page).pathname;
          return path !== '/' && path !== '';
        } catch {
          return true;
        }
      },
    }),
  ],
});
