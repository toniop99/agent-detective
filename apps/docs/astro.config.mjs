// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// https://starlight.astro.build/reference/configuration/
// Published at https://agent-detective.chapascript.dev/docs/ (custom domain in GitHub Settings → Pages; DNS e.g. Cloudflare CNAME → toniop99.github.io).
// Build nests output under dist/docs/ via scripts/stage-docs-dist.mjs so the site is served at /docs/ on the host.
export default defineConfig({
  site: 'https://agent-detective.chapascript.dev',
  base: '/docs',
  integrations: [
    // Must run before Starlight so ```mermaid``` blocks in synced Markdown become client-rendered SVG.
    mermaid({ autoTheme: true }),
    starlight({
      title: 'Agent Detective',
      description: 'AI-powered code analysis; plugins for Jira and more.',
      lastUpdated: true,
      editLink: {
        // The default Starlight edit link uses the on-disk content path.
        // Because we sync docs/ → apps/docs/src/content/docs, we override the EditLink component
        // to map routes back to docs/ paths in git.
        baseUrl: 'https://github.com/toniop99/agent-detective/edit/main/',
      },
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/docs/favicon-32.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/docs/apple-touch-icon.png' } },
      ],
      components: {
        EditLink: './src/components/EditLink.astro',
      },
      customCss: ['./src/styles/custom.css'],
      social: [
        {
          icon: 'external',
          label: 'Product site',
          href: 'https://agent-detective.chapascript.dev/en/',
        },
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
          label: 'Architecture',
          autogenerate: { directory: 'architecture' },
        },
        {
          label: 'E2E walkthroughs',
          badge: { text: 'Ops', variant: 'note' },
          autogenerate: { directory: 'e2e' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
        {
          label: 'Execution plans',
          collapsed: true,
          autogenerate: { directory: 'exec-plans' },
        },
        {
          label: 'Tool references',
          collapsed: true,
          autogenerate: { directory: 'references' },
        },
      ],
    }),
    mdx(),
  ],
});
