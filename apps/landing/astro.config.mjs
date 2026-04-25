// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://agent-detective.chapascript.dev/ (merged with Starlight at /docs/ in CI)
export default defineConfig({
  site: 'https://agent-detective.chapascript.dev',
  base: '/',
  output: 'static',
  build: { assets: 'landing' },
  vite: { plugins: [tailwindcss()] },
});
