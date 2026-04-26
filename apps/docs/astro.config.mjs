// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';

// https://starlight.astro.build/reference/configuration/
// Published at https://agent-detective.chapascript.dev/docs/ (custom domain in GitHub Settings → Pages; DNS e.g. Cloudflare CNAME → toniop99.github.io).
// Build nests output under dist/docs/ via scripts/stage-docs-dist.mjs so the site is served at /docs/ on the host.
export default defineConfig({
  site: 'https://agent-detective.chapascript.dev',
  base: '/docs',
  integrations: [
    starlight({
      title: 'Agent Detective',
      description: 'AI-powered code analysis; plugins for Jira and more.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/toniop99/agent-detective',
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Home', slug: 'index' },
            { label: 'Documentation index', slug: 'overview' },
          ],
        },
        {
          label: 'Run the server',
          autogenerate: { directory: 'operator' },
        },
        {
          label: 'Configuration',
          autogenerate: { directory: 'config' },
        },
        {
          label: 'Plugins',
          autogenerate: { directory: 'plugins' },
        },
        {
          label: 'Develop the monorepo',
          autogenerate: { directory: 'development' },
        },
        {
          label: 'Execution plans',
          autogenerate: { directory: 'exec-plans' },
        },
        {
          label: 'Tool references',
          autogenerate: { directory: 'references' },
        },
        {
          label: 'Architecture',
          autogenerate: { directory: 'architecture' },
        },
        {
          label: 'Jira (E2E)',
          autogenerate: { directory: 'e2e' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
    }),
    mdx(),
  ],
});
