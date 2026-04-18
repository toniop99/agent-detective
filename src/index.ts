import 'reflect-metadata';
import { createServer, loadConfig, setupDocs } from './server.js';
import { createPluginSystem, sanitizePluginName } from './core/plugin-system.js';
import { createAgentRunner } from './core/agent-runner.js';
import { createEnqueue } from './core/queue.js';
import { execLocal, execLocalStreaming, terminateChildProcess } from './core/process.js';
import { getAgent, getAgentLabel } from './agents/index.js';
import { createObservability } from '@agent-detective/observability';
import { generateSpecFromRoutes, getRegisteredRoutes } from './core/openapi/index.js';
import { CORE_PLUGIN_TAG } from './core/openapi/constants.js';

const config = loadConfig();

const observability = createObservability(config.observability || {});

const logger = observability.logger;
const serverLogger = logger.child('server');

serverLogger.info('Starting agent-detective...', {
  agent: getAgentLabel(config.agent || 'opencode'),
  port: config.port || 3001,
});

const agentRunner = createAgentRunner({
  execLocal,
  execLocalStreaming,
  terminateChildProcess,
  getAgent: (id: string) => getAgent(id || config.agent || 'opencode'),
  defaultModels: config.agents,
});

const queues = new Map<string, Promise<void>>();
const enqueue = createEnqueue(queues);

const { app, coreController } = createServer(config, observability, config.agents || {}, agentRunner, enqueue);

const pluginSystem = createPluginSystem({
  agentRunner,
  enqueue,
  logger: logger.child('plugin-system'),
});

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
    operationMetadata?: any;
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
    const pluginName = (ctrl as any).__pluginName || 'unknown-plugin';
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
