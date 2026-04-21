# Observability Package

The `@agent-detective/observability` package provides structured logging, metrics, tracing, and health checks for the agent-detective application.

**Main app (Express):** routes are under **`/api`**, e.g. **`GET /api/metrics`**, **`GET /api/health`**. The JSON `status` field is **`ok`**, **`degraded`**, or **`unhealthy`** (not a generic `"healthy"` string).

## Overview

Observability is a first-class concern in agent-detective. The package provides:

- **Logger** — Structured JSON logging with correlation IDs
- **Metrics** — Prometheus-compatible metrics endpoint
- **Tracing** — Distributed tracing context
- **Health** — Health check endpoints for orchestration systems

## Quick Start

```typescript
import { createObservability } from '@agent-detective/observability';

const obs = createObservability({
  logging: { level: 'info', format: 'json' },
  metrics: { enabled: true },
  health: { enabled: true },
});

// Use throughout your application
obs.logger.info('Server started', { port: 3001 });
obs.metrics.increment('http_requests_total', { method: 'GET' });
```

## Configuration

### Programmatic Configuration

```typescript
import { createObservability } from '@agent-detective/observability';

const obs = createObservability({
  enabled: true,
  serviceName: 'agent-detective',
  logging: {
    level: 'info',
    format: 'json',
    destination: 'stdout'
  },
  metrics: {
    enabled: true,
    endpoint: '/api/metrics'
  },
  tracing: {
    enabled: true,
    sampleRate: 1.0
  },
  health: {
    deep: true,
    includeGit: true,
    includePlugins: true
  }
});
```

### Environment Variable Overrides

All configuration can be overridden via environment variables:

| Environment Variable | Type | Default | Description |
|---------------------|------|---------|-------------|
| `OBSERVABILITY_LOG_LEVEL` | string | `info` | Log level (debug, info, warn, error) |
| `OBSERVABILITY_LOG_FORMAT` | string | `json` | Log format (json, pretty) |
| `OBSERVABILITY_FILE_ENABLED` | boolean | `false` | Enable file logging |
| `OBSERVABILITY_FILE_PATH` | string | `/var/log/agent-detective/app.log` | Log file path |
| `OBSERVABILITY_FILE_MAX_SIZE` | string | `100m` | Max log file size |
| `OBSERVABILITY_FILE_MAX_FILES` | number | `10` | Number of rotating files |
| `OBSERVABILITY_METRICS_ENABLED` | boolean | `true` | Enable metrics endpoint |
| `OBSERVABILITY_METRICS_ENDPOINT` | string | `/metrics` | Metrics scrape endpoint |
| `OBSERVABILITY_TRACING_ENABLED` | boolean | `true` | Enable tracing |
| `OBSERVABILITY_TRACING_SAMPLE_RATE` | number | `1.0` | Trace sampling rate (0-1) |
| `OBSERVABILITY_TRACING_ALWAYS_SAMPLE_FOR_PATHS` | string | — | Paths to always sample (comma-separated) |
| `OTEL_SERVICE_NAME` | string | `agent-detective` | Service name for tracing |

## Logger

### Creating a Logger

```typescript
import { createLogger } from '@agent-detective/observability';

const logger = createLogger({
  config: {
    level: 'info',
    format: 'json',
    destination: 'stdout',
    file: { enabled: false },
    pretty: { enabled: false },
  },
  serviceName: 'agent-detective',
  tracing, // optional tracing context
});
```

### Using the Logger

```typescript
// Basic logging
logger.info('Processing request', { requestId: '123' });
logger.warn('Rate limit approaching', { current: 950, limit: 1000 });
logger.error('Failed to process task', { taskId: '456', error: err.message });

// Child loggers with additional context
const childLogger = logger.child({ plugin: 'jira-adapter' });
childLogger.info('Webhook received', { event: 'issue.created' });
```

### Log Format

JSON logs include:
- `timestamp` — ISO 8601 timestamp
- `level` — Log level (debug, info, warn, error)
- `message` — Log message
- `service` — Service name
- `correlationId` — Tracing correlation ID (if active)
- `context` — Additional context fields

Example output:
```json
{"level":"info","time":"2026-04-15T22:00:00.000Z","msg":"Server started","service":"agent-detective","port":3001}
```

## Metrics

### Metrics Registry

```typescript
import { createMetrics } from '@agent-detective/observability';

const metrics = createMetrics({
  enabled: true,
  endpoint: '/metrics',
});
```

### Built-in Metrics

The observability package provides several built-in metrics:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | method, path, status | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | method, path | Request duration |
| `agent_runs_total` | Counter | agent, status | Total agent executions |
| `agent_run_duration_seconds` | Histogram | agent | Agent execution duration |
| `queue_tasks_total` | Counter | taskId | Tasks processed by queue |
| `plugin_load_duration_seconds` | Histogram | plugin | Plugin load times |

### Custom Metrics

```typescript
// Increment a counter
metrics.increment('custom_counter', { label: 'value' });

// Record a histogram value
metrics.record('custom_histogram', 0.5, { label: 'value' });

// Set a gauge
metrics.set('custom_gauge', 100, { label: 'value' });
```

### Prometheus Endpoint

When enabled, metrics are exposed at `/api/metrics` in Prometheus format:

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/health",status="200"} 42

# HELP agent_runs_total Total agent executions
# TYPE agent_runs_total counter
agent_runs_total{agent="opencode",status="success"} 15
```

## Health Checks

### Health Checker

```typescript
import { createHealthChecker } from '@agent-detective/observability';

const health = createHealthChecker({
  deep: true,
  includeGit: true,
  includePlugins: true,
}, logger);
```

### Health Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Basic health check (returns 200 if server is running) |

### Health Check Response

```json
{
  "status": "healthy",
  "timestamp": "2026-04-15T22:00:00.000Z",
  "checks": {
    "server": { "status": "up", "uptime": 3600 },
    "git": { "status": "up", "repoCount": 5 },
    "plugins": { "status": "up", "loadedCount": 2 }
  }
}
```

## Tracing

### Tracing Context

```typescript
import { createTracing } from '@agent-detective/observability';

const tracing = createTracing({
  enabled: true,
  sampleRate: 1.0,
  alwaysSampleForPaths: ['/health'],
});
```

### Correlation ID

The tracing module generates correlation IDs for request tracing:

```typescript
// Get current correlation context
const ctx = tracing.getCorrelationContext();

// Create a child span
const span = tracing.startSpan('operation-name', ctx);
```

## Middleware

### Request Logging Middleware

```typescript
import { createRequestLogger } from '@agent-detective/observability';

const requestLogger = createRequestLogger({
  logger,
  metrics,
  excludePaths: ['/api/health', '/api/metrics'],
});

// Use with Express
app.use(requestLogger);
```

### Correlation Middleware

```typescript
import { createCorrelationMiddleware } from '@agent-detective/observability';

app.use(createCorrelationMiddleware());
```

This middleware:
1. Extracts `X-Correlation-ID` from request headers
2. Generates a new ID if not present
3. Sets the ID in response headers
4. Makes correlation ID available to loggers

## Integration

### With Express Server

```typescript
import express from 'express';
import { createObservability } from '@agent-detective/observability';

const obs = createObservability();
const app = express();

// Apply middleware
app.use(obs.middleware?.correlation ?? createCorrelationMiddleware());
app.use(obs.middleware?.requestLogger ?? createRequestLogger({ logger: obs.logger, metrics: obs.metrics }));

app.get('/api/health', (req, res) => {
  res.json(obs.health.check());
});

app.get('/api/metrics', (req, res) => {
  res.send(obs.metrics.getPrometheusOutput());
});
```

### With Plugin System

The observability package integrates with the plugin system:

```typescript
// In your plugin
register(app, context) {
  const { logger } = context;
  
  logger.info('Plugin loaded', { pluginName: 'my-plugin' });
  
  // Use child logger with plugin context
  const pluginLogger = logger.child({ plugin: 'my-plugin' });
  pluginLogger.info('Webhook handler registered');
}
```

## Export Summary

```typescript
// Main export
export { createObservability } from './index.js';

// Individual exports
export { createLogger } from './logger.js';
export { createMetrics } from './metrics.js';
export { createTracing } from './tracing.js';
export { createHealthChecker } from './health.js';
export { createRequestLogger, createCorrelationMiddleware } from './middleware.js';

// Configuration
export { applyEnvOverrides, mergeObservabilityConfig, DEFAULT_OBSERVABILITY_CONFIG } from './config.js';

// Types
export type { Logger } from './logger.js';
export type { MetricsRegistry } from './metrics.js';
export type { TracingContext, CorrelationContext } from './tracing.js';
export type { HealthChecker, HealthCheckResult, HealthStatus } from './health.js';
export type { ObservabilityConfig, ObservabilityLoggingConfig, ObservabilityMetricsConfig, ObservabilityTracingConfig, ObservabilityHealthConfig } from './config.js';
```

## API Documentation Endpoint

Agent-detective provides an interactive API documentation UI at `/docs`.

### Accessing the Docs

Visit `http://localhost:3001/docs` in your browser to see the API reference.

### Endpoints

All core API endpoints are prefixed with `/api`:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Root info (no prefix) |
| `GET /api` | Server info (alias for root) |
| `GET /api/health` | Health check |
| `GET /api/agent/list` | List available agents |
| `POST /api/agent/run` | Run an agent |
| `POST /api/events` | Submit an event |
| `GET /api/queue/status` | Queue status |

Plugin routes are available under `/plugins/<plugin-name>/*`.

### Features

- Interactive API explorer (try endpoints directly)
- OpenAPI 3.0 specification
- Core routes under `/api/*` automatically documented
- Plugin routes under `/plugins/*` automatically documented

### Authentication

If `DOCS_AUTH_REQUIRED` is set to `true`, you must provide an `X-API-KEY` header:

```bash
curl -H "X-API-KEY: your-api-key" http://localhost:3001/docs
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DOCS_AUTH_REQUIRED` | Set to `true` to require API key |
| `DOCS_API_KEY` | The API key value |

### Plugin API Documentation

All plugins that register HTTP endpoints will automatically have their routes appear in the `/docs` UI. Plugins can provide OpenAPI metadata (summary, description, responses) via the `openapi` property on the plugin object. See [Plugin Development Guide](./plugin-development.md#api-documentation-openapi) for details.

## Notes

- The observability package is designed to be optional — the core agent-detective works without it
- All features have sensible defaults — you can enable just what you need
- Environment variables take precedence over config file settings
- The package uses structured logging by default for production use