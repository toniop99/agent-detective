import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
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

/** Repository root for resolving local plugin paths (packages/...). Uses process.cwd() so bundled dist/index.js matches Docker WORKDIR and local pnpm dev. */
const ROOT_DIR = process.cwd();

/** Load a plugin package: bare specifier, then monorepo packages (dist for production, src for dev). */
async function importPluginModuleFromSpecifier(spec: string): Promise<{ default?: Plugin } & Record<string, unknown>> {
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
    return import(pathToFileURL(resolve(ROOT_DIR, spec)).href);
  }
  try {
    return await import(spec);
  } catch {
    const short = spec.replace('@agent-detective/', '');
    const base = resolve(ROOT_DIR, 'packages', short);
    const distJs = resolve(base, 'dist/index.js');
    const srcJs = resolve(base, 'src/index.js');
    const filePath = existsSync(distJs) ? distJs : srcJs;
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
}

type PluginConfig = { plugins?: Array<{ package?: string; options?: Record<string, unknown> }> };

export function createPluginSystem(context: CreatePluginSystemOptions) {
  const {
    agentRunner,
    taskQueue: initialTaskQueue,
    logger = console,
    events,
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
  const servicesRegistry = new Map<string, unknown>();
  const capabilitiesRegistry = new Set<string>();
  const shutdownHooks: Array<() => void | Promise<void>> = [];

  function registerCapability(capability: string): void {
    capabilitiesRegistry.add(capability);
  }

  function hasCapability(capability: string): boolean {
    return capabilitiesRegistry.has(capability);
  }

  function registerService<T>(name: string, service: T): void {
    if (servicesRegistry.has(name)) {
      logger.warn(`Service ${name} already registered, overwriting`);
    }
    servicesRegistry.set(name, service);
  }

  function getService<T>(name: string): T {
    const service = servicesRegistry.get(name);
    if (!service) {
      throw new Error(`Service ${name} not found. Ensure the providing plugin is loaded.`);
    }
    return service as T;
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
      registerService,
      getService,
      registerAgent: (agent: Agent) => agentRunner.registerAgent(agent),
      registerCapability,
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
      logger.warn(`Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`);
      return null;
    }

    try {
      await plugin.register(app, prepared.ctx);
    } catch (err) {
      logger.warn(`Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`);
      return null;
    }

    const loaded: LoadedPlugin = {
      name: plugin.name,
      version: plugin.version,
      config: prepared.mergedConfig,
      dependsOn: plugin.dependsOn || [],
    };
    loadedPlugins.set(plugin.name, loaded);

    if (plugin.requiresCapabilities) {
      for (const req of plugin.requiresCapabilities) {
        if (!capabilitiesRegistry.has(req)) {
          logger.error(
            `Plugin ${plugin.name} requires capability '${req}' which is not provided by any loaded plugin.`,
          );
        }
      }
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
    const loadOrder: string[] = [];
    const errors: string[] = [];

    for (const p of plugins) {
      const packageName = typeof p === 'string' ? p : p.package;
      if (!packageName) continue;

      let plugin: Plugin;
      try {
        const pluginModule = await importPluginModuleFromSpecifier(packageName);
        plugin = ((pluginModule as { default?: Plugin }).default ?? pluginModule) as unknown as Plugin;
      } catch (err) {
        logger.warn(`Failed to load plugin metadata for ${packageName}: ${(err as Error).message}`);
        continue;
      }

      if (loadedPlugins.has(plugin.name)) continue;

      pluginData.set(plugin.name, {
        plugin,
        packageName,
        options: typeof p === 'object' ? p.options || {} : {},
      });
    }

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
        logger.warn(`Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`);
        continue;
      }

      const prefix = `/plugins/${sanitizePluginName(plugin.name)}`;

      app.register(
        async (childScope) => {
          try {
            await plugin.register(childScope, prepared.ctx);
            const loaded: LoadedPlugin = {
              name: plugin.name,
              version: plugin.version,
              config: prepared.mergedConfig,
              dependsOn: plugin.dependsOn || [],
            };
            loadedPlugins.set(plugin.name, loaded);
            logger.info(`Loaded plugin ${plugin.name}@${plugin.version}`);
          } catch (err) {
            // Swallow per-plugin failures so the rest of the boot continues
            // (mirrors the Express-era plugin system contract).
            logger.warn(
              `Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`,
            );
          }
        },
        { prefix },
      );
    }

    await app.ready();

    for (const loaded of loadedPlugins.values()) {
      const plugin = Array.from(pluginData.values()).find((d) => d.plugin.name === loaded.name)?.plugin;
      if (plugin && plugin.requiresCapabilities) {
        for (const req of plugin.requiresCapabilities) {
          if (!capabilitiesRegistry.has(req)) {
            logger.error(
              `Plugin ${loaded.name} requires capability '${req}' which is not provided by any loaded plugin.`,
            );
          }
        }
      }
    }
  }

  function getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(loadedPlugins.values());
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
    getPluginTags,
    enqueue: enqueueDelegate,
    shutdown,
  };
}
