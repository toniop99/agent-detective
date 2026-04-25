// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://starlight.astro.build/reference/configuration/
// GitHub project Pages: https://<user>.github.io/agent-detective/
export default defineConfig({
  site: 'https://toniop99.github.io',
  base: '/agent-detective',
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
          label: 'Overview',
          items: [{ label: 'Home', slug: 'index' }],
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'pages' },
        },
        {
          label: 'Jira (E2E)',
          autogenerate: { directory: 'e2e' },
        },
        {
          label: 'Architecture (ADR)',
          autogenerate: { directory: 'adr' },
        },
        {
          label: 'Reference (generated)',
          autogenerate: { directory: 'generated' },
        },
      ],
    }),
  ],
});
