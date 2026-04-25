// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://starlight.astro.build/reference/configuration/
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
          label: 'Get started',
          items: [
            { label: 'Overview', slug: 'index' },
            { label: 'Installation', link: 'https://github.com/toniop99/agent-detective/blob/main/docs/installation.md' },
            { label: 'Configuration hub', link: 'https://github.com/toniop99/agent-detective/blob/main/docs/configuration-hub.md' },
            { label: 'Upgrading', link: 'https://github.com/toniop99/agent-detective/blob/main/docs/upgrading.md' },
          ],
        },
      ],
    }),
  ],
});
