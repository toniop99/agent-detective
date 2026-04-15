import pino from 'pino';
import type { ObservabilityLoggingConfig, LogLevel } from './config.js';
import type { TracingContext } from './tracing.js';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, error?: Error, meta?: Record<string, unknown>): void;
  child(component: string | Record<string, string>): Logger;
  setLevel(level: LogLevel): void;
}

interface LoggerOptions {
  config: ObservabilityLoggingConfig;
  serviceName: string;
  tracing: TracingContext;
}

export function createLogger(options: LoggerOptions): Logger {
  const { config, serviceName, tracing } = options;

  const formatters = {
    level: (label: string) => ({ level: label }),
  };

  const baseLogger = pino({
    level: config.level,
    formatters,
    base: {
      service: serviceName,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  const childLoggers = new Map<string, Logger>();

  function formatMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
    const correlationId = tracing.getCorrelationId();
    if (!meta && !correlationId) return undefined;
    return {
      ...(correlationId ? { correlationId } : {}),
      ...meta,
    };
  }

  function formatError(error?: Error, meta?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!error) return formatMeta(meta);
    return {
      ...formatMeta(meta),
      err: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
    };
  }

  function createChildLogger(component: string): Logger {
    return {
      debug(msg: string, meta?: Record<string, unknown>) {
        baseLogger.debug(formatMeta({ ...meta, component }), msg);
      },
      info(msg: string, meta?: Record<string, unknown>) {
        baseLogger.info(formatMeta({ ...meta, component }), msg);
      },
      warn(msg: string, meta?: Record<string, unknown>) {
        baseLogger.warn(formatMeta({ ...meta, component }), msg);
      },
      error(msg: string, error?: Error, meta?: Record<string, unknown>) {
        baseLogger.error(formatError(error, { ...meta, component }), msg);
      },
      child(subComponent: string | Record<string, string>) {
        const subStr = typeof subComponent === 'string' ? subComponent : Object.values(subComponent).join(':');
        return createChildLogger(`${component}:${subStr}`);
      },
      setLevel(level: LogLevel) {
        baseLogger.level = level;
      },
    };
  }

  const logger: Logger = {
    debug(msg: string, meta?: Record<string, unknown>) {
      baseLogger.debug(formatMeta(meta), msg);
    },
    info(msg: string, meta?: Record<string, unknown>) {
      baseLogger.info(formatMeta(meta), msg);
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      baseLogger.warn(formatMeta(meta), msg);
    },
    error(msg: string, error?: Error, meta?: Record<string, unknown>) {
      baseLogger.error(formatError(error, meta), msg);
    },
    child(component: string | Record<string, string>) {
      const componentStr = typeof component === 'string' ? component : Object.values(component).join(':');
      if (!childLoggers.has(componentStr)) {
        childLoggers.set(componentStr, createChildLogger(componentStr));
      }
      return childLoggers.get(componentStr)!;
    },
    setLevel(level: LogLevel) {
      baseLogger.level = level;
    },
  };

  return logger;
}
