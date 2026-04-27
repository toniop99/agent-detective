import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from './logger.js';
import type { TracingContext } from './tracing.js';
import type { MetricsRegistry } from './metrics.js';

export interface RequestLoggingOptions {
  logger: Logger;
  tracing: TracingContext;
  metrics?: MetricsRegistry;
  /** Routes for which we skip log emission entirely (still served). */
  excludePaths?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Correlation id (from `x-correlation-id` header or freshly generated when sampled). */
    correlationId?: string;
    /** Request start timestamp captured by the observability hook. */
    startTime?: number;
  }
}

/**
 * Fastify plugin that logs every request (start + complete), records HTTP
 * metrics, and propagates a correlation id through the tracing context.
 *
 * Replaces the previous Express middleware; the wire-level behaviour is
 * preserved (same log shape, same metric labels, same `excludePaths` default).
 */
export function createRequestLogger(options: RequestLoggingOptions): FastifyPluginAsync {
  const { logger, tracing, metrics, excludePaths = ['/api/health', '/api/metrics'] } = options;
  const httpLogger = logger.child('http');

  function pathOf(req: FastifyRequest): string {
    return req.routeOptions?.url ?? req.url.split('?')[0] ?? req.url;
  }

  return async function requestLoggerPlugin(app: FastifyInstance) {
    app.addHook('onRequest', async (req: FastifyRequest) => {
      const path = pathOf(req);
      if (excludePaths.includes(path)) return;

      const headerCorrelationId = req.headers['x-correlation-id'];
      const correlationId =
        (typeof headerCorrelationId === 'string' ? headerCorrelationId : undefined) ??
        (tracing.shouldSample(path) ? tracing.generateCorrelationId() : undefined);

      req.correlationId = correlationId;
      req.startTime = Date.now();

      if (correlationId) {
        tracing.enterCorrelationContext(correlationId);
      }

      httpLogger.info('HTTP request start', {
        method: req.method,
        path,
        userAgent: req.headers['user-agent'],
      });
    });

    app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
      const path = pathOf(req);
      if (excludePaths.includes(path)) return;

      const startTime = req.startTime ?? Date.now();
      const durationMs = Date.now() - startTime;
      const statusCode = reply.statusCode;
      const logData = { method: req.method, path, statusCode, durationMs };

      if (statusCode >= 500) {
        httpLogger.error('HTTP request complete', undefined, logData);
      } else if (statusCode >= 400) {
        httpLogger.warn('HTTP request complete', logData);
      } else {
        httpLogger.info('HTTP request complete', logData);
      }

      if (metrics) {
        metrics.httpRequestsTotal.inc({ method: req.method, path, status: String(statusCode) });
        metrics.httpRequestDuration.observe({ method: req.method, path }, durationMs);
      }
    });
  };
}

/**
 * Fastify plugin variant of the legacy correlation middleware. When a request
 * carries an `x-correlation-id` header, sets it as the active correlation
 * context for the rest of the request via {@link TracingContext.enterCorrelationContext}
 * so any handler or hook that reads `tracing.getCorrelationId()` sees the id.
 */
export function createCorrelationMiddleware(tracing: TracingContext): FastifyPluginAsync {
  return async function correlationPlugin(app: FastifyInstance) {
    app.addHook('onRequest', async (req: FastifyRequest) => {
      const headerId = req.headers['x-correlation-id'];
      if (typeof headerId === 'string' && headerId) {
        req.correlationId = headerId;
        tracing.enterCorrelationContext(headerId);
      }
    });
  };
}
