import { defineConfig } from 'tsup';

/**
 * SEA-friendly bundle for embedding in a single executable.
 *
 * Key difference vs `tsup.config.ts`: we bundle dependencies instead of
 * leaving them `external`, because the SEA binary should not require
 * `node_modules` at runtime.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  // SEA currently loads the embedded entrypoint as CJS, so emit CJS here to
  // avoid "Cannot use import statement outside a module".
  format: ['cjs'],
  target: 'es2022',
  outDir: 'dist-sea',
  clean: true,
  bundle: true,
  external: [],
  // Force bundling of workspace deps + runtime deps so the SEA binary does not
  // attempt to `require()` them at runtime (SEA doesn't have node_modules).
  noExternal: [
    '@agent-detective/process-utils',
    '@agent-detective/sdk',
    '@agent-detective/types',
    '@agent-detective/observability',
    '@agent-detective/local-repos-plugin',
    '@agent-detective/jira-adapter',
    '@agent-detective/linear-adapter',
    '@agent-detective/pr-pipeline',
    'fastify',
    'fastify-type-provider-zod',
    '@fastify/swagger',
    '@scalar/openapi-types',
    'openapi-types',
    'zod',
  ],
  outExtension: () => ({ js: '.cjs' }),
});

