import { createServer, loadConfig } from './server.js';
import { createPluginSystem } from './core/plugin-system.js';
import { createAgentRunner } from './core/agent-runner.js';
import { createEnqueue } from './core/queue.js';
import { execLocal, execLocalStreaming, terminateChildProcess } from './core/process.js';
import { getAgent, getAgentLabel } from './agents/index.js';
import { createObservability } from '@agent-detective/observability';

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

const app = createServer(config, observability, config.agents || {}, agentRunner, enqueue);

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
});
