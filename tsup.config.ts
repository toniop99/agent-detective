import { defineConfig } from 'tsup';

/**
 * Production bundle for `node dist/index.js`.
 * Workspace packages and native-heavy deps stay external so Node resolves them from node_modules.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  bundle: true,
  external: [
    'fastify',
    'fastify-type-provider-zod',
    '@fastify/swagger',
    '@scalar/fastify-api-reference',
    '@scalar/openapi-types',
    'openapi-types',
    '@agent-detective/core',
    '@agent-detective/observability',
  ],
});
