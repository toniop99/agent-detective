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
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
