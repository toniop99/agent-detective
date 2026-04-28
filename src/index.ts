import { createEventBus } from './core/event-bus.js';
import { createOrchestrator } from './core/orchestrator.js';
import { createServer, loadConfig } from './server.js';
import { createPluginSystem } from './core/plugin-system.js';
import { createAgentRunner } from './core/agent-runner.js';
import { execLocal, execLocalStreaming, terminateChildProcess } from './core/process.js';
import { getAgentLabel, listAgents, normalizeAgent } from './agents/index.js';
import { createObservability } from '@agent-detective/observability';
import { applyLogLevelAliasForObservability } from './config/env-whitelist.js';
import { dirname, resolve } from 'node:path';
import { APP_NAME, APP_VERSION } from './version.js';
import { homedir } from 'node:os';

type CliArgs = {
  command: 'serve' | 'doctor' | 'validate-config' | 'help' | 'version';
  configRoot?: string;
};

function looksLikeNodeExecutable(execPath: string): boolean {
  const base = execPath.split(/[\\/]/).pop() ?? execPath;
  return base === 'node' || base === 'node.exe';
}

function resolveCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    return { command: 'help' };
  }
  if (args.includes('--version') || args[0] === 'version') {
    return { command: 'version' };
  }

  const command =
    args[0] === 'doctor'
      ? 'doctor'
      : args[0] === 'validate-config' || args.includes('--validate-config')
        ? 'validate-config'
        : 'serve';

  let configRoot: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--config-root') {
      configRoot = args[i + 1];
      i++;
    } else if (a?.startsWith('--config-root=')) {
      configRoot = a.slice('--config-root='.length);
    }
  }

  return { command, configRoot };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`${APP_NAME} ${APP_VERSION}

Usage:
  ${APP_NAME} [--config-root <dir>]              Start server (default)
  ${APP_NAME} doctor [--config-root <dir>] [--json] [--verbose]
                                              Validate config/tools/plugins and exit
  ${APP_NAME} validate-config [--config-root <dir>] [--json] [--verbose]
                                              Validate config only and exit
  ${APP_NAME} --version                         Print version and exit
  ${APP_NAME} --help                            Print this help and exit

Config:
  --config-root <dir>     Directory containing config/ (or the config/ dir itself)
  AGENT_DETECTIVE_CONFIG_ROOT can be used instead of --config-root
`);
}

function resolveInstallRoot(cliConfigRoot: string | undefined): string | undefined {
  const expandHome = (value: string): string => {
    if (value === '~') return homedir();
    if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
    return value;
  };

  if (cliConfigRoot) return resolve(expandHome(cliConfigRoot));
  if (process.env.AGENT_DETECTIVE_CONFIG_ROOT) return resolve(expandHome(process.env.AGENT_DETECTIVE_CONFIG_ROOT));

  // SEA-friendly fallback: use the directory containing the executable, but
  // avoid changing behavior when running under `node dist/index.js`.
  if (!looksLikeNodeExecutable(process.execPath)) {
    return dirname(process.execPath);
  }

  return undefined;
}

function resolveConfigDirFromInstallRoot(installRoot: string | undefined): string | undefined {
  if (!installRoot) return undefined;
  // Support passing either the install root or the config dir itself.
  if (installRoot.split(/[\\/]/).pop() === 'config') return installRoot;
  return resolve(installRoot, 'config');
}

async function serve(installRoot: string | undefined): Promise<void> {
  applyLogLevelAliasForObservability();
  const configRoot = resolveConfigDirFromInstallRoot(installRoot);
  const configRootUsed = configRoot ?? resolve(process.cwd(), 'config');
  const config = loadConfig({ configRoot });

  const observability = createObservability(config.observability || {});

  const logger = observability.logger;
  const serverLogger = logger.child('server');

  serverLogger.info('Starting agent-detective...', {
    agent: getAgentLabel(config.agent || 'opencode'),
    port: config.port || 3001,
    configRoot: configRootUsed,
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
    metrics: observability.metrics,
    health: observability.health,
    failOnContractErrors: config.pluginSystem?.failOnContractErrors ?? false,
    failOnDependencyErrors: config.pluginSystem?.failOnDependencyErrors ?? true,
    failOnPluginLoadErrors: config.pluginSystem?.failOnPluginLoadErrors ?? true,
    pathResolutionRoot: installRoot ?? process.cwd(),
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
    getPluginStatus: () => ({
      loaded: pluginSystem.getLoadedPlugins().map((p) => `${p.name}@${p.version}`),
      failures: pluginSystem.getPluginLoadFailures(),
    }),
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
}

async function main(): Promise<void> {
  const cli = resolveCliArgs(process.argv);
  const installRoot = resolveInstallRoot(cli.configRoot);

  if (cli.command === 'help') {
    printHelp();
    return;
  }

  if (cli.command === 'version') {
    // eslint-disable-next-line no-console
    console.log(APP_VERSION);
    return;
  }

  if (cli.command === 'doctor') {
    const mod = await import('./cli/doctor.js');
    await mod.runDoctor({ installRoot, argv: process.argv });
    return;
  }

  if (cli.command === 'validate-config') {
    const mod = await import('./cli/doctor.js');
    await mod.runValidateConfig({ installRoot, argv: process.argv });
    return;
  }

  await serve(installRoot);
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
