import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  splitting: false,
  clean: true,
  external: [
    '@agent-detective/types',
    '@agent-detective/core',
    '@agent-detective/process-utils',
    'zod',
  ],
});
