import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { CODE_ANALYSIS_SERVICE, REPO_CONTEXT_SERVICE, StandardCapabilities } from '@agent-detective/sdk';
import type { MetricsRegistry, HealthChecker } from '@agent-detective/observability';
import type {
  Agent,
  EnqueueFn,
  LoadedPlugin,
  Plugin,
  PluginContext,
  TaskQueue,
} from './types.js';
import { createMemoryTaskQueue } from './queue.js';
import { validatePluginConfig, validatePluginSchema } from './schema-validator.js';
import { getBuiltInPlugin } from './built-in-plugins.js';

/** Load a plugin package: bare specifier, then monorepo packages (dist for production, src for dev). */
export async function importPluginModuleFromSpecifier(
  spec: string,
  resolveRootDir: string,
): Promise<{ default?: Plugin } & Record<string, unknown>> {
  const builtIn = getBuiltInPlugin(spec);
  if (builtIn) {
    return { default: builtIn };
  }
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
    return import(pathToFileURL(resolve(resolveRootDir, spec)).href);
  }
  try {
    return await import(spec);
  } catch {
    const short = spec.replace('@agent-detective/', '');
    const base = resolve(resolveRootDir, 'packages', short);
    const distJs = resolve(base, 'dist/index.js');
    const srcJs = resolve(base, 'src/index.js');
    let filePath: string | null = null;
    if (existsSync(distJs)) filePath = distJs;
    else if (existsSync(srcJs)) filePath = srcJs;
    if (!filePath) {
      throw new Error(
        `Failed to resolve ${spec} from monorepo fallback. Expected ${distJs} (run workspace build) or ${srcJs} (JS source).`
      );
    }
    return import(pathToFileURL(filePath).href);
  }
}

/**
 * Sanitizes a plugin's npm-style name into a URL-safe segment used for the
 * Fastify register prefix. Stable across the repo (`@scope/name` → `scope-name`).
 */
export function sanitizePluginName(name: string): string {
  return name
    .replace(/^@/, '')
    .replace(/\//g, '-');
}

export interface CreatePluginSystemOptions {
  agentRunner: PluginContext['agentRunner'];
  /** Initial queue; defaults to in-memory per-key serialization. */
  taskQueue?: TaskQueue;
  logger?: PluginContext['logger'];
  events: PluginContext['events'];
  metrics?: Pick<MetricsRegistry, 'pluginsLoaded' | 'pluginLoadDuration'>;
  health?: Pick<HealthChecker, 'registerPluginCheck'>;
  /** Base directory for resolving local plugin paths (`./`, `../`) and monorepo fallbacks. Defaults to `process.cwd()`. */
  pathResolutionRoot?: string;
  /** When true, throw from loadAll() if any contract errors are detected. */
  failOnContractErrors?: boolean;
  /** When true, throw from loadAll() if dependency resolution errors are detected. */
  failOnDependencyErrors?: boolean;
  /** When true, throw from loadAll() if any plugin fails to import/validate/register. */
  failOnPluginLoadErrors?: boolean;
}

type PluginConfig = { plugins?: Array<{ package?: string; options?: Record<string, unknown> }> };

export function createPluginSystem(context: CreatePluginSystemOptions) {
  const {
    agentRunner,
    taskQueue: initialTaskQueue,
    logger = console,
    events,
    metrics,
    health,
    pathResolutionRoot = process.cwd(),
    failOnContractErrors = false,
    failOnDependencyErrors = true,
    failOnPluginLoadErrors = true,
  } = context;

  const defaultQueue: TaskQueue = initialTaskQueue ?? createMemoryTaskQueue(logger);

  let activeQueue: TaskQueue = defaultQueue;

  const enqueueDelegate: EnqueueFn = (queueKey, fn) => activeQueue.enqueue(queueKey, fn);

  function registerTaskQueue(queue: TaskQueue): void {
    const previous = activeQueue;
    activeQueue = queue;
    try {
      const shutdownResult = previous.shutdown?.();
      if (shutdownResult !== undefined && typeof (shutdownResult as Promise<void>).then === 'function') {
        (shutdownResult as Promise<void>).catch((err: unknown) =>
          logger.warn(`Previous task queue shutdown failed: ${(err as Error).message}`)
        );
      }
    } catch (err) {
      logger.warn(`Previous task queue shutdown failed: ${(err as Error).message}`);
    }
  }

  const loadedPlugins = new Map<string, LoadedPlugin>();
  const activePlugins = new Set<string>();
  const servicesRegistry = new Map<string, Map<string, unknown>>();
  const capabilitiesRegistry = new Map<string, Set<string>>();
  const shutdownHooks: Array<() => void | Promise<void>> = [];
  let providerPriorityByPluginName: Map<string, number> | null = null;
  const pluginLoadFailures: Array<{ plugin: string; stage: 'import' | 'validate' | 'register'; message: string }> = [];
  let healthCheckRegistered = false;
  let lastConfiguredPluginsCount = 0;

  const MULTI_PROVIDER_SERVICE_KEYS = new Set<string>([
    // Capability-backed services
    REPO_CONTEXT_SERVICE,
    CODE_ANALYSIS_SERVICE,
  ]);

  const CAPABILITY_BACKED_CONTRACTS: Array<{ capability: string; serviceKey: string }> = [
    { capability: StandardCapabilities.REPO_CONTEXT, serviceKey: REPO_CONTEXT_SERVICE },
    { capability: StandardCapabilities.CODE_ANALYSIS, serviceKey: CODE_ANALYSIS_SERVICE },
  ];

  function isFirstPartyPlugin(pluginName: string): boolean {
    return pluginName.startsWith('@agent-detective/');
  }

  function registerCapabilityForPlugin(providerPluginName: string, capability: string): void {
    const existing = capabilitiesRegistry.get(capability);
    if (!existing) {
      capabilitiesRegistry.set(capability, new Set([providerPluginName]));
      return;
    }
    existing.add(providerPluginName);
  }

  function hasCapability(capability: string): boolean {
    const providers = capabilitiesRegistry.get(capability);
    if (!providers || providers.size === 0) return false;
    for (const provider of providers) {
      if (isPluginActiveOrLoaded(provider)) return true;
    }
    return false;
  }

  function registerServiceForPlugin<T>(providerPluginName: string, name: string, service: T): void {
    const existing = servicesRegistry.get(name);
    if (!existing) {
      servicesRegistry.set(name, new Map([[providerPluginName, service as unknown]]));
      return;
    }

    const hadProvider = existing.has(providerPluginName);
    const hadAny = existing.size > 0;

    if (hadProvider) {
      logger.warn(`Service ${name} already registered, overwriting`);
    } else if (hadAny && !MULTI_PROVIDER_SERVICE_KEYS.has(name)) {
      logger.warn(`Service ${name} already registered, overwriting`);
    }

    existing.set(providerPluginName, service as unknown);
  }

  function isPluginActiveOrLoaded(name: string): boolean {
    return activePlugins.has(name) || loadedPlugins.has(name);
  }

  function getActiveProvidersForService(name: string): Map<string, unknown> {
    const providers = servicesRegistry.get(name);
    if (!providers) return new Map();
    const active = new Map<string, unknown>();
    for (const [providerName, svc] of providers) {
      if (isPluginActiveOrLoaded(providerName)) {
        active.set(providerName, svc);
      }
    }
    return active;
  }

  function getServiceFromPlugin<T>(name: string, providerPluginName: string): T {
    if (!isPluginActiveOrLoaded(providerPluginName)) {
      throw new Error(
        `Service ${name} not found for provider ${providerPluginName}. Ensure the providing plugin is loaded.`,
      );
    }

    const providers = getActiveProvidersForService(name);
    const service = providers.get(providerPluginName);
    if (!service) {
      const knownProviders = providers ? Array.from(providers.keys()) : [];
      const suffix = knownProviders.length ? ` Known providers: ${knownProviders.join(', ')}` : '';
      throw new Error(
        `Service ${name} not found for provider ${providerPluginName}. Ensure the providing plugin is loaded.${suffix}`
      );
    }
    return service as T;
  }

  function selectDefaultProviderService(_name: string, providers: Map<string, unknown>): unknown {
    if (providers.size === 1) {
      return providers.values().next().value;
    }

    // Prefer first-party providers over third-party, then use the config.plugins
    // order (stable) as a tie-break. If we don't have config-derived priority
    // (e.g. `loadPlugin` path), fall back to registration insertion order.
    const priority = providerPriorityByPluginName;
    if (!priority) {
      for (const [providerName, service] of providers) {
        if (isFirstPartyPlugin(providerName)) return service;
      }
      return providers.values().next().value;
    }

    type Candidate = { providerName: string; service: unknown; isFirstParty: boolean; rank: number };
    const candidates: Candidate[] = [];
    for (const [providerName, service] of providers) {
      const rank = priority.get(providerName) ?? Number.MAX_SAFE_INTEGER;
      candidates.push({ providerName, service, isFirstParty: isFirstPartyPlugin(providerName), rank });
    }

    candidates.sort((a, b) => {
      if (a.isFirstParty !== b.isFirstParty) return a.isFirstParty ? -1 : 1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return 0;
    });

    return candidates[0]!.service;
  }

  function getService<T>(name: string): T {
    const providers = getActiveProvidersForService(name);
    if (!providers || providers.size === 0) {
      throw new Error(`Service ${name} not found. Ensure the providing plugin is loaded.`);
    }
    return selectDefaultProviderService(name, providers) as T;
  }

  function buildPluginContext(plugin: Plugin, mergedConfig: Record<string, unknown>): PluginContext {
    return {
      agentRunner,
      enqueue: enqueueDelegate,
      config: mergedConfig,
      logger:
        'child' in logger && typeof logger.child === 'function'
          ? logger.child({ plugin: plugin.name })
          : logger,
      events,
      registerService: <T>(name: string, service: T) => registerServiceForPlugin(plugin.name, name, service),
      getService,
      getServiceFromPlugin,
      registerAgent: (agent: Agent) => agentRunner.registerAgent(agent),
      registerCapability: (capability: string) => registerCapabilityForPlugin(plugin.name, capability),
      hasCapability,
      registerTaskQueue,
      onShutdown: (fn) => shutdownHooks.push(fn),
    };
  }

  /**
   * Registers a single plugin on the Fastify app under
   * `/plugins/{sanitizePluginName(plugin.name)}` using native
   * `fastify.register` encapsulation. Each plugin gets its own scope: any
   * hooks (`onRequest`, `preHandler`, `setErrorHandler`) it adds to `scope`
   * stay local to that plugin's routes.
   */
  /**
   * Resolves a plugin's merged config (defaults + overrides). Throws on
   * invalid schema or invalid config so callers can convert to a soft warn.
   */
  function preparePlugin(
    plugin: Plugin,
    pluginConfig: Record<string, unknown>,
  ): { mergedConfig: Record<string, unknown>; ctx: PluginContext } {
    validatePluginSchema(plugin);

    const mergedConfig: Record<string, unknown> = { ...pluginConfig };
    if (plugin.schema?.properties) {
      for (const [key, prop] of Object.entries(plugin.schema.properties)) {
        if (mergedConfig[key] === undefined && prop.default !== undefined) {
          mergedConfig[key] = prop.default;
        }
      }
    }

    validatePluginConfig(plugin, mergedConfig);

    return { mergedConfig, ctx: buildPluginContext(plugin, mergedConfig) };
  }

  /**
   * Loads a single plugin eagerly: runs its `register` synchronously against
   * the supplied Fastify instance (no scope encapsulation) so service /
   * capability side-effects are immediately visible. This is the path used
   * by tests and ad-hoc loads. Production boot uses `loadAll`, which mounts
   * each plugin under an encapsulated `/plugins/{name}` scope.
   */
  async function loadPlugin(
    plugin: Plugin,
    app: FastifyInstance,
    pluginConfig: Record<string, unknown>,
  ): Promise<LoadedPlugin | null> {
    if (loadedPlugins.has(plugin.name)) {
      logger.warn(`Plugin ${plugin.name} already loaded, skipping`);
      return loadedPlugins.get(plugin.name) ?? null;
    }

    let prepared: ReturnType<typeof preparePlugin>;
    try {
      prepared = preparePlugin(plugin, pluginConfig);
    } catch (err) {
      pluginLoadFailures.push({ plugin: plugin.name, stage: 'validate', message: (err as Error).message });
      logger.warn(`Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`);
      return null;
    }

    const start = Date.now();
    activePlugins.add(plugin.name);
    try {
      await plugin.register(app, prepared.ctx);
    } catch (err) {
      pluginLoadFailures.push({ plugin: plugin.name, stage: 'register', message: (err as Error).message });
      logger.warn(`Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`);
      return null;
    } finally {
      activePlugins.delete(plugin.name);
      metrics?.pluginLoadDuration.observe({ plugin: plugin.name }, Date.now() - start);
    }

    const loaded: LoadedPlugin = {
      name: plugin.name,
      version: plugin.version,
      config: prepared.mergedConfig,
      dependsOn: plugin.dependsOn || [],
    };
    loadedPlugins.set(plugin.name, loaded);
    metrics?.pluginsLoaded.set({ plugin: plugin.name }, 1);

    const contractErrors: string[] = [];
    if (plugin.requiresCapabilities) {
      for (const req of plugin.requiresCapabilities) {
        if (!hasCapability(req)) {
          const available = Array.from(capabilitiesRegistry.keys()).sort();
          contractErrors.push(
            `Plugin ${plugin.name} requires capability '${req}' which is not provided by any loaded plugin.`
          );
          logger.error(
            `Plugin ${plugin.name} requires capability '${req}' which is not provided by any loaded plugin. Available capabilities: ${
              available.length ? available.join(', ') : '(none)'
            }`,
          );
        }
      }
    }

    for (const { capability, serviceKey } of CAPABILITY_BACKED_CONTRACTS) {
      // Provider validation: if this plugin claims to provide a capability, ensure it registered the mapped service.
      const providersForCapability = capabilitiesRegistry.get(capability);
      if (providersForCapability?.has(plugin.name)) {
        const svcProviders = servicesRegistry.get(serviceKey);
        if (!svcProviders || !svcProviders.has(plugin.name)) {
          contractErrors.push(
            `Plugin ${plugin.name} declares capability '${capability}' but did not register required service '${serviceKey}'.`
          );
          logger.error(
            `Plugin ${plugin.name} declares capability '${capability}' but did not register required service '${serviceKey}'.`,
          );
        }
      }

      // Consumer validation: if this plugin requires a capability-backed capability, ensure some provider registered the mapped service.
      if (plugin.requiresCapabilities?.includes(capability)) {
        const activeProviders = getActiveProvidersForService(serviceKey);
        if (activeProviders.size === 0) {
          contractErrors.push(
            `Plugin ${plugin.name} requires capability '${capability}' but no provider registered service '${serviceKey}'.`
          );
          logger.error(
            `Plugin ${plugin.name} requires capability '${capability}' but no provider registered service '${serviceKey}'.`,
          );
        }
      }
    }

    if (failOnContractErrors && contractErrors.length > 0) {
      throw new Error(
        `Plugin contract errors detected (failOnContractErrors=true):\n- ${contractErrors.join('\n- ')}`
      );
    }

    logger.info(`Loaded plugin ${plugin.name}@${plugin.version}`);

    return loaded;
  }

  /**
   * Loads every plugin listed in `config.plugins` onto the given Fastify
   * instance. Resolution order is topological over `dependsOn`; missing
   * dependencies and circular cycles are logged but do not abort boot.
   */
  async function loadAll(
    app: FastifyInstance,
    config: PluginConfig,
  ): Promise<void> {
    const plugins = config.plugins || [];

    const pluginData = new Map<
      string,
      { plugin: Plugin; packageName: string; options: Record<string, unknown> }
    >();
    const configOrder: string[] = [];
    const loadOrder: string[] = [];
    const errors: string[] = [];

    for (const p of plugins) {
      const packageName = typeof p === 'string' ? p : p.package;
      if (!packageName) continue;

      let plugin: Plugin;
      try {
        const pluginModule = await importPluginModuleFromSpecifier(packageName, pathResolutionRoot);
        plugin = ((pluginModule as { default?: Plugin }).default ?? pluginModule) as unknown as Plugin;
      } catch (err) {
        pluginLoadFailures.push({
          plugin: packageName,
          stage: 'import',
          message: (err as Error).message,
        });
        logger.warn(`Failed to load plugin metadata for ${packageName}: ${(err as Error).message}`);
        continue;
      }

      if (loadedPlugins.has(plugin.name)) continue;

      pluginData.set(plugin.name, {
        plugin,
        packageName,
        options: typeof p === 'object' ? p.options || {} : {},
      });
      configOrder.push(plugin.name);
    }

    providerPriorityByPluginName = new Map(configOrder.map((name, idx) => [name, idx]));

    const visited = new Set<string>();
    const visiting = new Set<string>();

    function visit(name: string, path: string[]): boolean {
      if (visited.has(name)) return true;
      if (visiting.has(name)) {
        errors.push(`Circular dependency detected: ${path.join(' -> ')} -> ${name}`);
        return false;
      }

      const data = pluginData.get(name);
      if (!data) {
        if (loadedPlugins.has(name)) {
          visited.add(name);
          return true;
        }
        errors.push(`Plugin ${name} not found in config but required by ${path.join(' -> ')}`);
        return false;
      }

      visiting.add(name);
      const deps = data.plugin.dependsOn || [];

      for (const dep of deps) {
        if (!visit(dep, [...path, name])) {
          visiting.delete(name);
          return false;
        }
      }

      visiting.delete(name);
      visited.add(name);
      loadOrder.push(name);
      return true;
    }

    for (const name of pluginData.keys()) {
      visit(name, [name]);
    }

    for (const error of errors) {
      logger.error(`Plugin dependency error: ${error}`);
    }

    if (failOnDependencyErrors && errors.length > 0) {
      throw new Error(
        `Plugin dependency errors detected (failOnDependencyErrors=true):\n- ${errors.join('\n- ')}`
      );
    }

    logger.info(`Plugin load order: ${loadOrder.join(' -> ')}`);

    // Queue every plugin on the app in topo order before driving `ready()`
    // (Fastify forbids registering more plugins after the first `ready()`
    // resolves). Avvio processes the queue serially, so each plugin's
    // side-effects (registerService, registerCapability, registerAgent) are
    // visible to the next plugin's `register()` callback.
    for (const name of loadOrder) {
      const data = pluginData.get(name)!;
      const { plugin, options } = data;

      if (loadedPlugins.has(plugin.name)) {
        logger.warn(`Plugin ${plugin.name} already loaded, skipping`);
        continue;
      }

      let prepared: ReturnType<typeof preparePlugin>;
      try {
        prepared = preparePlugin(plugin, options);
      } catch (err) {
        pluginLoadFailures.push({ plugin: plugin.name, stage: 'validate', message: (err as Error).message });
        logger.warn(`Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`);
        continue;
      }

      const prefix = `/plugins/${sanitizePluginName(plugin.name)}`;

      app.register(
        async (childScope) => {
          activePlugins.add(plugin.name);
          const start = Date.now();
          try {
            await plugin.register(childScope, prepared.ctx);
            const loaded: LoadedPlugin = {
              name: plugin.name,
              version: plugin.version,
              config: prepared.mergedConfig,
              dependsOn: plugin.dependsOn || [],
            };
            loadedPlugins.set(plugin.name, loaded);
            metrics?.pluginsLoaded.set({ plugin: plugin.name }, 1);
            logger.info(`Loaded plugin ${plugin.name}@${plugin.version}`);
          } catch (err) {
            // Swallow per-plugin failures so the rest of the boot continues
            // (mirrors the Express-era plugin system contract).
            pluginLoadFailures.push({ plugin: plugin.name, stage: 'register', message: (err as Error).message });
            logger.warn(
              `Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`,
            );
          } finally {
            activePlugins.delete(plugin.name);
            metrics?.pluginLoadDuration.observe({ plugin: plugin.name }, Date.now() - start);
          }
        },
        { prefix },
      );
    }

    await app.ready();

    if (failOnPluginLoadErrors && pluginLoadFailures.length > 0) {
      const rendered = pluginLoadFailures
        .map((f) => `${f.plugin} (${f.stage}): ${f.message}`)
        .join('\n- ');
      throw new Error(
        `Plugin load errors detected (failOnPluginLoadErrors=true):\n- ${rendered}`
      );
    }

    const contractErrors: string[] = [];

    lastConfiguredPluginsCount = Array.isArray(config.plugins) ? config.plugins.length : 0;
    if (health && !healthCheckRegistered) {
      health.registerPluginCheck('plugin-system', async () => {
        const start = Date.now();
        const configured = lastConfiguredPluginsCount;
      const loaded = loadedPlugins.size;
      const status = configured === loaded ? 'ok' : loaded > 0 ? 'degraded' : 'unhealthy';
      return {
        name: 'plugin-system',
        status,
        durationMs: Date.now() - start,
        details: {
          configured,
          loaded,
          failures: pluginLoadFailures.slice(-10),
        },
      };
      });
      healthCheckRegistered = true;
    }

    // Validate capability-backed contracts: if a plugin declares a capability
    // as provided, ensure it also registered the mapped service key; if a plugin
    // requires the capability, ensure at least one active provider exists.
    for (const { capability, serviceKey } of CAPABILITY_BACKED_CONTRACTS) {
      const providersForCapability = capabilitiesRegistry.get(capability) ?? new Set<string>();
      for (const provider of providersForCapability) {
        if (!loadedPlugins.has(provider)) continue;
        const svcProviders = servicesRegistry.get(serviceKey);
        if (!svcProviders || !svcProviders.has(provider)) {
          contractErrors.push(
            `Plugin ${provider} declares capability '${capability}' but did not register required service '${serviceKey}'.`
          );
          logger.error(
            `Plugin ${provider} declares capability '${capability}' but did not register required service '${serviceKey}'.`,
          );
        }
      }
    }

    for (const loaded of loadedPlugins.values()) {
      const plugin = Array.from(pluginData.values()).find((d) => d.plugin.name === loaded.name)?.plugin;
      if (plugin && plugin.requiresCapabilities) {
        for (const req of plugin.requiresCapabilities) {
          if (!hasCapability(req)) {
            const available = Array.from(capabilitiesRegistry.keys()).sort();
            contractErrors.push(
              `Plugin ${loaded.name} requires capability '${req}' which is not provided by any loaded plugin.`
            );
            logger.error(
              `Plugin ${loaded.name} requires capability '${req}' which is not provided by any loaded plugin. Available capabilities: ${
                available.length ? available.join(', ') : '(none)'
              }`,
            );
          }
        }
      }
    }

    for (const loaded of loadedPlugins.values()) {
      const plugin = Array.from(pluginData.values()).find((d) => d.plugin.name === loaded.name)?.plugin;
      if (!plugin?.requiresCapabilities) continue;
      for (const { capability, serviceKey } of CAPABILITY_BACKED_CONTRACTS) {
        if (!plugin.requiresCapabilities.includes(capability)) continue;
        const activeProviders = getActiveProvidersForService(serviceKey);
        if (activeProviders.size === 0) {
          contractErrors.push(
            `Plugin ${loaded.name} requires capability '${capability}' but no provider registered service '${serviceKey}'.`
          );
          logger.error(
            `Plugin ${loaded.name} requires capability '${capability}' but no provider registered service '${serviceKey}'.`,
          );
        }
      }
    }

    if (failOnContractErrors && contractErrors.length > 0) {
      throw new Error(
        `Plugin contract errors detected (failOnContractErrors=true):\n- ${contractErrors.join('\n- ')}`
      );
    }
  }

  function getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(loadedPlugins.values());
  }

  function getPluginLoadFailures(): Array<{ plugin: string; stage: 'import' | 'validate' | 'register'; message: string }> {
    return [...pluginLoadFailures];
  }

  /** Tag names to surface under the Scalar "Plugins" group on `/docs`. */
  function getPluginTags(): string[] {
    return Array.from(loadedPlugins.keys());
  }

  async function shutdown(): Promise<void> {
    for (const hook of shutdownHooks) {
      try {
        await hook();
      } catch (err) {
        logger.warn(`Plugin shutdown hook failed: ${(err as Error).message}`);
      }
    }
  }

  return {
    loadPlugin,
    loadAll,
    getLoadedPlugins,
    getPluginLoadFailures,
    getPluginTags,
    enqueue: enqueueDelegate,
    shutdown,
  };
}
