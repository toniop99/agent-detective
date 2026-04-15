export type {
  ObservabilityConfig,
  ObservabilityLoggingConfig,
  ObservabilityMetricsConfig,
  ObservabilityTracingConfig,
  ObservabilityHealthConfig,
  LogLevel,
  LogFormat,
  LogDestination,
} from './config.js';

export {
  DEFAULT_OBSERVABILITY_CONFIG,
  applyEnvOverrides,
  mergeObservabilityConfig,
} from './config.js';

export type { TracingContext, CorrelationContext } from './tracing.js';
export { createTracing } from './tracing.js';

export type { Logger } from './logger.js';
export { createLogger } from './logger.js';

export type { MetricsRegistry } from './metrics.js';
export { createMetrics } from './metrics.js';

export type { RequestLoggingOptions } from './middleware.js';
export { createRequestLogger, createCorrelationMiddleware } from './middleware.js';

export type { HealthChecker, HealthCheckResult, HealthStatus } from './health.js';
export { createHealthChecker } from './health.js';

import { createLogger, type Logger } from './logger.js';
import { createMetrics, type MetricsRegistry } from './metrics.js';
import { createTracing, type TracingContext } from './tracing.js';
import { createHealthChecker, type HealthChecker } from './health.js';
import { applyEnvOverrides, mergeObservabilityConfig, DEFAULT_OBSERVABILITY_CONFIG, type ObservabilityConfig } from './config.js';

export interface Observability {
  logger: Logger;
  metrics: MetricsRegistry;
  tracing: TracingContext;
  health: HealthChecker;
  config: ObservabilityConfig;
}

export function createObservability(
  userConfig: Partial<ObservabilityConfig> = {}
): Observability {
  const mergedConfig = mergeObservabilityConfig(DEFAULT_OBSERVABILITY_CONFIG, userConfig);
  const finalConfig = applyEnvOverrides(mergedConfig);

  const tracing = createTracing(finalConfig.tracing);
  const logger = createLogger({
    config: finalConfig.logging,
    serviceName: finalConfig.serviceName,
    tracing,
  });
  const metrics = createMetrics(finalConfig.metrics);
  const health = createHealthChecker(finalConfig.health, logger);

  return {
    logger,
    metrics,
    tracing,
    health,
    config: finalConfig,
  };
}
