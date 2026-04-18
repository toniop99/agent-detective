import { validatePluginSchema, validatePluginConfig } from './schema-validator.js';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import type { Plugin, PluginContext, LoadedPlugin } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../..');

export function sanitizePluginName(name: string): string {
  return name
    .replace(/^@/, '')
    .replace(/\//g, '-');
}

function createPrefixedApp(
  app: import('express').Application,
  pluginName: string,
): import('express').Application {
  const prefix = `/plugins/${sanitizePluginName(pluginName)}`;

  return new Proxy(app, {
    get(target, prop) {
      if (['get', 'post', 'put', 'delete', 'patch', 'all', 'head', 'options'].includes(prop as string)) {
        return (path: string, ...handlers: unknown[]) => {
          const prefixedPath = path === '/' ? prefix : `${prefix}${path}`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (target as any)[prop](prefixedPath, ...handlers);
        };
      }
      if (prop === 'use') {
        return (path: string | Function, ...handlers: unknown[]) => {
          if (typeof path === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (target as any).use(path, ...handlers);
          }
          if (path.startsWith('/plugins/')) {
            console.warn(`Plugin ${pluginName} registered path '${path}' which appears to already be prefixed. Path will be used as-is.`);
          }
          const prefixedPath = path === '/' ? prefix : `${prefix}${path}`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (target as any).use(prefixedPath, ...handlers);
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (target as any)[prop];
    }
  });
}

interface CreatePluginSystemOptions {
  agentRunner: PluginContext['agentRunner'];
  enqueue?: PluginContext['enqueue'];
  logger?: PluginContext['logger'];
}

type PluginConfig = { plugins?: Array<{ package?: string; options?: Record<string, unknown> }> };

export function createPluginSystem(context: CreatePluginSystemOptions) {
  const {
    agentRunner,
    enqueue,
    logger = console,
  } = context;

  const loadedPlugins = new Map<string, LoadedPlugin>();
  const pluginControllers: object[] = [];
  const servicesRegistry = new Map<string, unknown>();

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

  async function loadPlugin(
    packageNameOrPlugin: string | Plugin,
    app: import('express').Application,
    pluginConfig: Record<string, unknown> = {},
    sharedContext?: PluginContext
  ): Promise<LoadedPlugin | null> {
    let plugin: Plugin;

    if (typeof packageNameOrPlugin === 'object' && packageNameOrPlugin !== null) {
      plugin = packageNameOrPlugin as Plugin;
    } else {
      const packageName = packageNameOrPlugin;
      try {
        if (packageName.startsWith('./') || packageName.startsWith('../') || packageName.startsWith('/')) {
          const resolvedPath = resolve(ROOT_DIR, packageName);
          const pluginModule = await import(resolvedPath);
          plugin = (pluginModule as { default?: Plugin }).default || pluginModule as Plugin;
        } else {
          try {
            const pluginModule = await import(packageName);
            plugin = (pluginModule as { default?: Plugin }).default || pluginModule as Plugin;
          } catch {
            const localPath = resolve(ROOT_DIR, 'packages', packageName.replace('@agent-detective/', ''), 'src', 'index.js');
            const pluginModule = await import(localPath);
            plugin = (pluginModule as { default?: Plugin }).default || pluginModule as Plugin;
          }
        }
      } catch (err) {
        logger.warn(`Failed to load plugin ${packageName}: ${(err as Error).message}. Continuing...`);
        return null;
      }
    }

    if (loadedPlugins.has(plugin.name)) {
      logger.warn(`Plugin ${plugin.name} already loaded, skipping`);
      return loadedPlugins.get(plugin.name) ?? null;
    }

    try {
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

      const pluginContext: PluginContext = {
        agentRunner,
        enqueue,
        config: mergedConfig,
        logger: 'child' in logger && typeof logger.child === 'function'
          ? logger.child({ plugin: plugin.name })
          : logger,
        controllers: pluginControllers,
        registerService: sharedContext?.registerService || registerService,
        getService: sharedContext?.getService || getService,
        registerAgent: (agent: any) => agentRunner.registerAgent(agent),
      };

      const prefixedApp = createPrefixedApp(app, plugin.name);
      const result = await plugin.register(prefixedApp, pluginContext);

      if (result) {
        const ctrls = Array.isArray(result) ? result : [result];
        for (const ctrl of ctrls) {
          (ctrl as any).__pluginName = plugin.name;
        }
        pluginControllers.push(...ctrls);
      }

      const loaded: LoadedPlugin = {
        name: plugin.name,
        version: plugin.version,
        config: mergedConfig,
        dependsOn: plugin.dependsOn || [],
      };
      loadedPlugins.set(plugin.name, loaded);

      logger.info(`Loaded plugin ${plugin.name}@${plugin.version}`);

      return loaded;
    } catch (err) {
      logger.warn(`Failed to load plugin ${plugin.name}: ${(err as Error).message}. Continuing...`);
      return null;
    }
  }

  async function loadAll(
    app: import('express').Application,
    config: PluginConfig
  ): Promise<void> {
    const plugins = config.plugins || [];

    const pluginData = new Map<string, { plugin: Plugin; packageName: string; options: Record<string, unknown> }>();
    const loadOrder: string[] = [];
    const errors: string[] = [];

    for (const p of plugins) {
      const packageName = typeof p === 'string' ? p : p.package;
      if (!packageName) continue;

      let plugin: Plugin;
      try {
        if (packageName.startsWith('./') || packageName.startsWith('../') || packageName.startsWith('/')) {
          const resolvedPath = resolve(ROOT_DIR, packageName);
          const pluginModule = await import(resolvedPath);
          plugin = (pluginModule as { default?: Plugin }).default || pluginModule as Plugin;
        } else {
          try {
            const pluginModule = await import(packageName);
            plugin = (pluginModule as { default?: Plugin }).default || pluginModule as Plugin;
          } catch {
            const localPath = resolve(ROOT_DIR, 'packages', packageName.replace('@agent-detective/', ''), 'src', 'index.js');
            const pluginModule = await import(localPath);
            plugin = (pluginModule as { default?: Plugin }).default || pluginModule as Plugin;
          }
        }
      } catch (err) {
        logger.warn(`Failed to load plugin metadata for ${packageName}: ${(err as Error).message}`);
        continue;
      }

      if (loadedPlugins.has(plugin.name)) continue;

      pluginData.set(plugin.name, {
        plugin,
        packageName,
        options: typeof p === 'object' ? (p.options || {}) : {},
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
        // If it's already loaded, it's fine
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

    const sharedContext: PluginContext = {
      agentRunner,
      enqueue,
      config: {},
      logger,
      controllers: pluginControllers,
      registerService,
      getService,
      registerAgent: (agent: any) => agentRunner.registerAgent(agent),
    };

    for (const name of loadOrder) {
      const data = pluginData.get(name)!;
      await loadPlugin(data.plugin, app, data.options, sharedContext);
    }
  }

  function getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(loadedPlugins.values());
  }

  function getControllers(): object[] {
    return [...pluginControllers];
  }

  return {
    loadPlugin,
    loadAll,
    getLoadedPlugins,
    getControllers,
  };
}
