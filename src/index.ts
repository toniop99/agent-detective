import 'reflect-metadata';
import { createEventBus } from './core/event-bus.js';
import { createOrchestrator } from './core/orchestrator.js';
import { createServer, loadConfig, setupDocs } from './server.js';
import { createPluginSystem, sanitizePluginName } from './core/plugin-system.js';
import { createAgentRunner } from './core/agent-runner.js';
import { execLocal, execLocalStreaming, terminateChildProcess } from './core/process.js';
import { getAgentLabel, listAgents } from './agents/index.js';
import { createObservability } from '@agent-detective/observability';
import {
  generateSpecFromRoutes,
  getRegisteredRoutes,
  CORE_PLUGIN_TAG,
  type OperationMetadata,
} from '@agent-detective/core';
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
});

// Register built-in agents
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

const { app, coreController } = createServer(config, observability, defaultModels, agentRunner, enqueue);

const PORT = config.port || 3001;

app.listen(PORT, async () => {
  serverLogger.info('Server started', { port: PORT, listeningOn: `http://localhost:${PORT}` });

  await pluginSystem.loadAll(app, config);

  const loaded = pluginSystem.getLoadedPlugins();
  if (loaded.length > 0) {
    serverLogger.info('Loaded plugins', {
      plugins: loaded.map((p) => `${p.name}@${p.version}`),
    });
  } else {
    serverLogger.info('No plugins loaded');
  }

  const pluginControllers = pluginSystem.getControllers();
  
  const allRoutes: Array<{
    method: string;
    path: string;
    prefixedPath: string;
    pluginName: string;
    operationMetadata?: OperationMetadata;
  }> = [];

  const coreRoutes = getRegisteredRoutes(coreController);
  for (const r of coreRoutes) {
    allRoutes.push({
      method: r.method,
      path: r.path,
      prefixedPath: r.path,
      pluginName: CORE_PLUGIN_TAG,
      operationMetadata: r.operationMetadata,
    });
  }

  for (const ctrl of pluginControllers) {
    const pluginName = pluginSystem.getPluginNameForController(ctrl) || 'unknown-plugin';
    const prefix = `/plugins/${sanitizePluginName(pluginName)}`;
    const routes = getRegisteredRoutes(ctrl);
    for (const r of routes) {
      allRoutes.push({
        method: r.method,
        path: r.path,
        prefixedPath: `${prefix}${r.path}`,
        pluginName: pluginName,
        operationMetadata: r.operationMetadata,
      });
    }
  }

  setupDocs(app, allRoutes, observability, config);

  const spec = generateSpecFromRoutes(allRoutes);
  serverLogger.info('Generated OpenAPI spec', {
    paths: Object.keys(spec.paths).length,
    tags: spec.tags.map((t: { name: string }) => t.name).join(', '),
  });
});
