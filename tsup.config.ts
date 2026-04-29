import { defineConfig } from 'tsup';

/**
 * Production bundle for `node dist/index.js`.
 * Workspace packages and native-heavy deps stay external so Node resolves them from node_modules.
 *
 * **jira.js** is a root dependency and listed `external` so it is not bundled. Bundling it under ESM
 * pulls in axios → form-data / mime-types with CJS `require()` of Node built-ins, which breaks
 * ("Dynamic require of util/path is not supported").
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  bundle: true,
  external: [
    'jira.js',
    'fastify',
    'fastify-type-provider-zod',
    '@fastify/swagger',
    '@scalar/fastify-api-reference',
    '@scalar/openapi-types',
    'openapi-types',
    '@agent-detective/sdk',
    '@agent-detective/types',
    '@agent-detective/observability',
  ],
});
