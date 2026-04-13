import { createServer, loadConfig } from './server.js';
import { createPluginSystem } from './core/plugin-system.js';
import { createAgentRunner } from './core/agent-runner.js';
import { createEnqueue } from './core/queue.js';
import { execLocal, execLocalStreaming, terminateChildProcess } from './core/process.js';
import { getAgent, getAgentLabel } from './agents/index.js';

const config = loadConfig();

console.info('Starting code-detective...');
console.info(`Agent: ${getAgentLabel(config.agent || 'opencode')}`);
console.info(`Port: ${config.port || 3001}`);

const agentRunner = createAgentRunner({
  execLocal,
  execLocalStreaming,
  terminateChildProcess,
  getAgent: (id: string) => getAgent(id || config.agent || 'opencode'),
  defaultModels: config.agents,
});

const queues = new Map<string, Promise<void>>();
const enqueue = createEnqueue(queues);

const app = createServer(config, config.agents || {}, agentRunner, enqueue);

const pluginSystem = createPluginSystem({
  agentRunner,
  enqueue,
  logger: console,
});

const PORT = config.port || 3001;

app.listen(PORT, async () => {
  console.info(`Server listening on http://localhost:${PORT}`);

  await pluginSystem.loadAll(app, config);

  const loaded = pluginSystem.getLoadedPlugins();
  if (loaded.length > 0) {
    console.info('Loaded plugins:');
    for (const plugin of loaded) {
      console.info(`  - ${plugin.name}@${plugin.version}`);
    }
  } else {
    console.info('No plugins loaded');
  }
});
