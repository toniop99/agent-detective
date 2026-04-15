import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import type { ObservabilityMetricsConfig } from './config.js';

const DEFAULT_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export interface MetricsRegistry {
  httpRequestsTotal: Counter<string>;
  httpRequestDuration: Histogram<string>;
  agentRunsTotal: Counter<string>;
  agentRunDuration: Histogram<string>;
  agentOutputBytes: Histogram<string>;
  agentStreamingEventsTotal: Counter<string>;
  queueTasksTotal: Counter<string>;
  queueWaitDuration: Histogram<string>;
  queueExecutionDuration: Histogram<string>;
  queueDepthCurrent: Gauge<string>;
  pluginsLoaded: Gauge<string>;
  pluginLoadDuration: Histogram<string>;
  gitOperationsTotal: Counter<string>;
  gitOperationDuration: Histogram<string>;
  jiraWebhooksTotal: Counter<string>;
  jiraAnalysisDuration: Histogram<string>;
  jiraCommentsPostedTotal: Counter<string>;
  getMetrics(): Promise<string>;
  clear(): void;
}

export function createMetrics(config: ObservabilityMetricsConfig): MetricsRegistry {
  const registry = new Registry();

  if (config.enabled) {
    collectDefaultMetrics({ register: registry });
  }

  const httpRequestsTotal = new Counter({
    name: 'agent_detective_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'path', 'status'],
    registers: [registry],
  });

  const httpRequestDuration = new Histogram({
    name: 'agent_detective_http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'path'],
    buckets: DEFAULT_BUCKETS.map((b) => b * 1000),
    registers: [registry],
  });

  const agentRunsTotal = new Counter({
    name: 'agent_detective_agent_runs_total',
    help: 'Total agent executions',
    labelNames: ['agentId', 'status'],
    registers: [registry],
  });

  const agentRunDuration = new Histogram({
    name: 'agent_detective_agent_run_duration_ms',
    help: 'Agent execution duration in milliseconds',
    labelNames: ['agentId'],
    buckets: DEFAULT_BUCKETS.map((b) => b * 1000),
    registers: [registry],
  });

  const agentOutputBytes = new Histogram({
    name: 'agent_detective_agent_output_bytes',
    help: 'Agent output size in bytes',
    labelNames: ['agentId'],
    buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
    registers: [registry],
  });

  const agentStreamingEventsTotal = new Counter({
    name: 'agent_detective_agent_streaming_events_total',
    help: 'Total streaming events from agents',
    labelNames: ['agentId'],
    registers: [registry],
  });

  const queueTasksTotal = new Counter({
    name: 'agent_detective_queue_tasks_total',
    help: 'Total queue task completions',
    labelNames: ['queueKey', 'status'],
    registers: [registry],
  });

  const queueWaitDuration = new Histogram({
    name: 'agent_detective_queue_wait_duration_ms',
    help: 'Time spent waiting in queue in milliseconds',
    labelNames: ['queueKey'],
    buckets: DEFAULT_BUCKETS.map((b) => b * 1000),
    registers: [registry],
  });

  const queueExecutionDuration = new Histogram({
    name: 'agent_detective_queue_execution_duration_ms',
    help: 'Queue task execution duration in milliseconds',
    labelNames: ['queueKey'],
    buckets: DEFAULT_BUCKETS.map((b) => b * 1000),
    registers: [registry],
  });

  const queueDepthCurrent = new Gauge({
    name: 'agent_detective_queue_depth_current',
    help: 'Current queue depth',
    labelNames: ['queueKey'],
    registers: [registry],
  });

  const pluginsLoaded = new Gauge({
    name: 'agent_detective_plugins_loaded',
    help: 'Number of loaded plugins',
    labelNames: ['plugin'],
    registers: [registry],
  });

  const pluginLoadDuration = new Histogram({
    name: 'agent_detective_plugin_load_duration_ms',
    help: 'Plugin load duration in milliseconds',
    labelNames: ['plugin'],
    buckets: DEFAULT_BUCKETS.map((b) => b * 1000),
    registers: [registry],
  });

  const gitOperationsTotal = new Counter({
    name: 'agent_detective_git_operations_total',
    help: 'Total git operations',
    labelNames: ['operation', 'status'],
    registers: [registry],
  });

  const gitOperationDuration = new Histogram({
    name: 'agent_detective_git_operation_duration_ms',
    help: 'Git operation duration in milliseconds',
    labelNames: ['operation'],
    buckets: DEFAULT_BUCKETS.map((b) => b * 1000),
    registers: [registry],
  });

  const jiraWebhooksTotal = new Counter({
    name: 'agent_detective_jira_webhooks_total',
    help: 'Total Jira webhooks received',
    labelNames: ['event', 'action', 'status'],
    registers: [registry],
  });

  const jiraAnalysisDuration = new Histogram({
    name: 'agent_detective_jira_analysis_duration_ms',
    help: 'Jira analysis duration in milliseconds',
    labelNames: ['action'],
    buckets: DEFAULT_BUCKETS.map((b) => b * 1000),
    registers: [registry],
  });

  const jiraCommentsPostedTotal = new Counter({
    name: 'agent_detective_jira_comments_posted_total',
    help: 'Total Jira comments posted',
    labelNames: ['status'],
    registers: [registry],
  });

  async function getMetrics(): Promise<string> {
    return registry.metrics();
  }

  function clear(): void {
    registry.clear();
  }

  return {
    httpRequestsTotal,
    httpRequestDuration,
    agentRunsTotal,
    agentRunDuration,
    agentOutputBytes,
    agentStreamingEventsTotal,
    queueTasksTotal,
    queueWaitDuration,
    queueExecutionDuration,
    queueDepthCurrent,
    pluginsLoaded,
    pluginLoadDuration,
    gitOperationsTotal,
    gitOperationDuration,
    jiraWebhooksTotal,
    jiraAnalysisDuration,
    jiraCommentsPostedTotal,
    getMetrics,
    clear,
  };
}
