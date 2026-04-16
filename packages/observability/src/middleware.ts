import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Logger } from './logger.js';
import type { TracingContext } from './tracing.js';
import type { MetricsRegistry } from './metrics.js';

export interface RequestLoggingOptions {
  logger: Logger;
  tracing: TracingContext;
  metrics?: MetricsRegistry;
  excludePaths?: string[];
}

export function createRequestLogger(options: RequestLoggingOptions): RequestHandler {
  const { logger, tracing, metrics, excludePaths = ['/api/health', '/api/metrics'] } = options;

  const httpLogger = logger.child('http');

  return (req: Request, res: Response, next: NextFunction) => {
    if (excludePaths.includes(req.path)) {
      return next();
    }

    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (tracing.shouldSample(req.path)
        ? tracing.generateCorrelationId()
        : undefined);

    const startTime = Date.now();

    if (correlationId) {
      tracing.withCorrelationId(correlationId, () => {
        httpLogger.info('HTTP request start', {
          method: req.method,
          path: req.path,
          userAgent: req.headers['user-agent'],
        });
      });
    } else {
      httpLogger.info('HTTP request start', {
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
      });
    }

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const statusCode = res.statusCode;

      const logData = {
        method: req.method,
        path: req.path,
        statusCode,
        durationMs,
      };

      if (correlationId) {
        tracing.withCorrelationId(correlationId, () => {
          if (statusCode >= 500) {
            httpLogger.error('HTTP request complete', undefined, logData);
          } else if (statusCode >= 400) {
            httpLogger.warn('HTTP request complete', logData);
          } else {
            httpLogger.info('HTTP request complete', logData);
          }
        });
      } else {
        if (statusCode >= 500) {
          httpLogger.error('HTTP request complete', undefined, logData);
        } else if (statusCode >= 400) {
          httpLogger.warn('HTTP request complete', logData);
        } else {
          httpLogger.info('HTTP request complete', logData);
        }
      }

      if (metrics) {
        metrics.httpRequestsTotal.inc({
          method: req.method,
          path: req.path,
          status: String(statusCode),
        });
        metrics.httpRequestDuration.observe(
          { method: req.method, path: req.path },
          durationMs
        );
      }
    });

    next();
  };
}

export function createCorrelationMiddleware(
  tracing: TracingContext
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    if (correlationId) {
      tracing.withCorrelationId(correlationId, () => {
        next();
      });
    } else {
      next();
    }
  };
}
