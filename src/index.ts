import { createEventBus } from './core/event-bus.js';
import { createOrchestrator } from './core/orchestrator.js';
import { createServer, loadConfig } from './server.js';
import { createPluginSystem } from './core/plugin-system.js';
import { createAgentRunner } from './core/agent-runner.js';
import { execLocal, execLocalStreaming, terminateChildProcess } from './core/process.js';
import { getAgentLabel, listAgents, normalizeAgent } from './agents/index.js';
import { createObservability } from '@agent-detective/observability';
import { applyLogLevelAliasForObservability } from './config/env-whitelist.js';

applyLogLevelAliasForObservability();
const config = loadConfig();

const observability = createObservability(config.observability || {});

const logger = observability.logger;
const serverLogger = logger.child('server');

serverLogger.info('Starting agent-detective...', {
  agent: getAgentLabel(config.agent || 'opencode'),
  port: config.port || 3001,
});

const defaultModels: Record<string, { defaultModel?: string }> = {};
let runnerConfig:
  | {
      timeoutMs?: number;
      maxBufferBytes?: number;
      postFinalGraceMs?: number;
      forceKillDelayMs?: number;
    }
  | undefined;
if (config.agents) {
  for (const [key, value] of Object.entries(config.agents)) {
    if (key === 'runner') {
      runnerConfig = value as typeof runnerConfig;
    } else {
      defaultModels[key] = value as { defaultModel?: string };
    }
  }
}

const agentRunner = createAgentRunner({
  execLocal,
  execLocalStreaming,
  terminateChildProcess,
  defaultModels,
  agentTimeoutMs: runnerConfig?.timeoutMs,
  agentMaxBuffer: runnerConfig?.maxBufferBytes,
  postFinalGraceMs: runnerConfig?.postFinalGraceMs,
  forceKillDelayMs: runnerConfig?.forceKillDelayMs,
  logger: logger.child('agent-runner'),
  defaultAgentId: normalizeAgent(config.agent),
});

for (const agent of listAgents()) {
  agentRunner.registerAgent(agent);
}

const eventBus = createEventBus(logger.child('events'));

const pluginSystem = createPluginSystem({
  agentRunner,
  events: eventBus,
  logger: logger.child('plugin-system'),
});

const enqueue = pluginSystem.enqueue;

const orchestrator = createOrchestrator({
  eventBus,
  agentRunner,
  enqueue,
  logger: logger.child('orchestrator'),
});
orchestrator.start();

const { app } = await createServer(config, observability, defaultModels, agentRunner, enqueue, {
  getPluginTags: () => pluginSystem.getPluginTags(),
});

await pluginSystem.loadAll(app, config);

const loaded = pluginSystem.getLoadedPlugins();
if (loaded.length > 0) {
  serverLogger.info('Loaded plugins', {
    plugins: loaded.map((p) => `${p.name}@${p.version}`),
  });
} else {
  serverLogger.info('No plugins loaded');
}

const PORT = config.port || 3001;

async function gracefulShutdown(signal: string) {
  serverLogger.info(`Received ${signal}, shutting down...`);
  const timeout = setTimeout(() => process.exit(1), 10_000);
  timeout.unref();
  await pluginSystem.shutdown();
  await app.close();
  agentRunner.shutdown();
  clearTimeout(timeout);
  process.exit(0);
}
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

await app.listen({ port: PORT, host: '0.0.0.0' });
serverLogger.info('Server started', {
  port: PORT,
  listeningOn: `http://localhost:${PORT}`,
});

const spec = app.swagger();
serverLogger.info('Generated OpenAPI spec', {
  paths: Object.keys(spec.paths ?? {}).length,
  tags: (spec.tags ?? []).map((t) => t.name).join(', '),
});
