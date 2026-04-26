import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  splitting: false,
  clean: true,
  external: [
    '@agent-detective/types',
    'fastify',
    'fastify-type-provider-zod',
    '@fastify/swagger',
    'openapi-types',
    'zod',
  ],
});
