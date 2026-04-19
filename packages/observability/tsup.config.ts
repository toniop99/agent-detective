import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    logger: 'src/logger.ts',
    metrics: 'src/metrics.ts',
    tracing: 'src/tracing.ts',
    middleware: 'src/middleware.ts',
    health: 'src/health.ts',
  },
  format: 'esm',
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  splitting: false,
  sourcemap: true,
  clean: true,
});
