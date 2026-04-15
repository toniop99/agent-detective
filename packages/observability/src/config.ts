export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';
export type LogDestination = 'stdout' | 'file';

export interface ObservabilityLoggingFileConfig {
  enabled: boolean;
  path: string;
  maxSize: string;
  maxFiles: number;
}

export interface ObservabilityLoggingPrettyConfig {
  enabled: boolean;
  colorize: boolean;
  translateTime: boolean;
}

export interface ObservabilityLoggingConfig {
  level: LogLevel;
  format: LogFormat;
  destination: LogDestination;
  file: ObservabilityLoggingFileConfig;
  pretty: ObservabilityLoggingPrettyConfig;
}

export interface ObservabilityMetricsConfig {
  enabled: boolean;
  endpoint: string;
}

export interface ObservabilityTracingConfig {
  enabled: boolean;
  sampleRate: number;
  alwaysSampleForPaths: string[];
}

export interface ObservabilityHealthConfig {
  deep: boolean;
  includeGit: boolean;
  includePlugins: boolean;
}

export interface ObservabilityConfig {
  serviceName: string;
  logging: ObservabilityLoggingConfig;
  metrics: ObservabilityMetricsConfig;
  tracing: ObservabilityTracingConfig;
  health: ObservabilityHealthConfig;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  serviceName: 'agent-detective',
  logging: {
    level: 'info',
    format: 'json',
    destination: 'stdout',
    file: {
      enabled: false,
      path: '/var/log/agent-detective/app.log',
      maxSize: '100m',
      maxFiles: 10,
    },
    pretty: {
      enabled: false,
      colorize: true,
      translateTime: true,
    },
  },
  metrics: {
    enabled: true,
    endpoint: '/metrics',
  },
  tracing: {
    enabled: true,
    sampleRate: 1.0,
    alwaysSampleForPaths: [],
  },
  health: {
    deep: true,
    includeGit: true,
    includePlugins: true,
  },
};

function parseLogLevel(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined;
  if (['debug', 'info', 'warn', 'error'].includes(value)) {
    return value as LogLevel;
  }
  return undefined;
}

function parseLogFormat(value: string | undefined): LogFormat | undefined {
  if (!value) return undefined;
  if (['json', 'pretty'].includes(value)) {
    return value as LogFormat;
  }
  return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  return value === 'true' || value === '1';
}

function parseNumber(value: string | undefined, min = 0, max = 1): number | undefined {
  if (!value) return undefined;
  const num = parseFloat(value);
  if (isNaN(num)) return undefined;
  return Math.max(min, Math.min(max, num));
}

function parseString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value;
}

function parseStringArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function applyEnvOverrides(config: ObservabilityConfig): ObservabilityConfig {
  const result = structuredClone(config);

  const envLogLevel = parseLogLevel(process.env.OBSERVABILITY_LOG_LEVEL);
  if (envLogLevel) result.logging.level = envLogLevel;

  const envLogFormat = parseLogFormat(process.env.OBSERVABILITY_LOG_FORMAT);
  if (envLogFormat) result.logging.format = envLogFormat;

  const envFileEnabled = parseBoolean(process.env.OBSERVABILITY_FILE_ENABLED);
  if (envFileEnabled !== undefined) result.logging.file.enabled = envFileEnabled;

  const envFilePath = parseString(process.env.OBSERVABILITY_FILE_PATH);
  if (envFilePath) result.logging.file.path = envFilePath;

  const envFileMaxSize = parseString(process.env.OBSERVABILITY_FILE_MAX_SIZE);
  if (envFileMaxSize) result.logging.file.maxSize = envFileMaxSize;

  const envFileMaxFiles = parseInt(process.env.OBSERVABILITY_FILE_MAX_FILES ?? '', 10);
  if (!isNaN(envFileMaxFiles) && envFileMaxFiles > 0) {
    result.logging.file.maxFiles = envFileMaxFiles;
  }

  const envMetricsEnabled = parseBoolean(process.env.OBSERVABILITY_METRICS_ENABLED);
  if (envMetricsEnabled !== undefined) result.metrics.enabled = envMetricsEnabled;

  const envMetricsEndpoint = parseString(process.env.OBSERVABILITY_METRICS_ENDPOINT);
  if (envMetricsEndpoint) result.metrics.endpoint = envMetricsEndpoint;

  const envTracingEnabled = parseBoolean(process.env.OBSERVABILITY_TRACING_ENABLED);
  if (envTracingEnabled !== undefined) result.tracing.enabled = envTracingEnabled;

  const envTracingSampleRate = parseNumber(
    process.env.OBSERVABILITY_TRACING_SAMPLE_RATE,
    0,
    1
  );
  if (envTracingSampleRate !== undefined) result.tracing.sampleRate = envTracingSampleRate;

  const envAlwaysSamplePaths = parseStringArray(process.env.OBSERVABILITY_TRACING_ALWAYS_SAMPLE_FOR_PATHS);
  if (envAlwaysSamplePaths) result.tracing.alwaysSampleForPaths = envAlwaysSamplePaths;

  const envServiceName = parseString(process.env.OTEL_SERVICE_NAME);
  if (envServiceName) result.serviceName = envServiceName;

  return result;
}

export function mergeObservabilityConfig(
  base: Partial<ObservabilityConfig>,
  overrides: Partial<ObservabilityConfig>
): ObservabilityConfig {
  const result = structuredClone(DEFAULT_OBSERVABILITY_CONFIG);

  if (base.serviceName) result.serviceName = base.serviceName;
  if (overrides.serviceName) result.serviceName = overrides.serviceName;

  result.logging = {
    ...result.logging,
    ...(base.logging ?? {}),
    ...(overrides.logging ?? {}),
    file: {
      ...result.logging.file,
      ...(base.logging?.file ?? {}),
      ...(overrides.logging?.file ?? {}),
    },
    pretty: {
      ...result.logging.pretty,
      ...(base.logging?.pretty ?? {}),
      ...(overrides.logging?.pretty ?? {}),
    },
  };

  result.metrics = {
    ...result.metrics,
    ...(base.metrics ?? {}),
    ...(overrides.metrics ?? {}),
  };

  result.tracing = {
    ...result.tracing,
    ...(base.tracing ?? {}),
    ...(overrides.tracing ?? {}),
  };

  result.health = {
    ...result.health,
    ...(base.health ?? {}),
    ...(overrides.health ?? {}),
  };

  return result;
}
