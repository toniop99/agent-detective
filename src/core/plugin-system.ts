import { validatePluginSchema, validatePluginConfig } from './schema-validator.js';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import type { Plugin, PluginContext, LoadedPlugin } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../..');

function sanitizePluginName(name: string): string {
  return name
    .replace(/^@/, '')
    .replace(/\//g, '-');
}

function createPrefixedApp(
  app: import('express').Application,
  pluginName: string
): import('express').Application {
  const prefix = `/plugins/${sanitizePluginName(pluginName)}`;

  return new Proxy(app, {
    get(target, prop) {
      if (['get', 'post', 'put', 'delete', 'patch'].includes(prop as string)) {
        return (path: string, ...handlers: unknown[]) => {
          const prefixedPath = path === '/' ? prefix : `${prefix}${path}`;
          return (target as Record<string, unknown>)[prop as string](prefixedPath, ...handlers);
        };
      }
      return (target as Record<string, unknown>)[prop as string];
    }
  });
}

interface CreatePluginSystemOptions {
  agentRunner: PluginContext['agentRunner'];
  repoMapping?: PluginContext['repoMapping'];
  buildRepoContext?: PluginContext['buildRepoContext'];
  formatRepoContextForPrompt?: PluginContext['formatRepoContextForPrompt'];
  enqueue?: PluginContext['enqueue'];
  logger?: PluginContext['logger'];
}

export function createPluginSystem(context: CreatePluginSystemOptions) {
  const {
    agentRunner,
    repoMapping,
    buildRepoContext,
    formatRepoContextForPrompt,
    enqueue,
    logger = console,
  } = context;

  const loadedPlugins = new Map<string, LoadedPlugin>();

  async function loadPlugin(
    packageNameOrPlugin: string | Plugin,
    app: import('express').Application,
    pluginConfig: Record<string, unknown> = {}
  ): Promise<LoadedPlugin | null> {
    let packageName: string;
    let plugin: Plugin;

    if (typeof packageNameOrPlugin === 'object' && packageNameOrPlugin !== null) {
      plugin = packageNameOrPlugin as Plugin;
      packageName = plugin.name;

      if (loadedPlugins.has(packageName)) {
        logger.warn(`Plugin ${packageName} already loaded, skipping`);
        return loadedPlugins.get(packageName) ?? null;
      }
    } else {
      packageName = packageNameOrPlugin;

      if (loadedPlugins.has(packageName)) {
        logger.warn(`Plugin ${packageName} already loaded, skipping`);
        return loadedPlugins.get(packageName) ?? null;
      }

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
            const localPath = resolve(ROOT_DIR, 'packages', packageName.replace('@code-detective/', ''), 'src', 'index.js');
            const pluginModule = await import(localPath);
            plugin = (pluginModule as { default?: Plugin }).default || pluginModule as Plugin;
          }
        }
      } catch (err) {
        logger.warn(`Failed to load plugin ${packageName}: ${(err as Error).message}. Continuing...`);
        return null;
      }
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
        repoMapping,
        buildRepoContext,
        formatRepoContextForPrompt,
        enqueue,
        config: mergedConfig,
        logger: 'child' in logger && typeof logger.child === 'function' 
          ? logger.child({ plugin: packageName }) 
          : logger,
      };

      const prefixedApp = createPrefixedApp(app, plugin.name);
      plugin.register(prefixedApp, pluginContext);

      const loaded: LoadedPlugin = {
        name: plugin.name,
        version: plugin.version,
        config: mergedConfig,
        dependsOn: plugin.dependsOn || [],
      };
      loadedPlugins.set(packageName, loaded);

      logger.info(`Loaded plugin ${plugin.name}@${plugin.version}`);

      return loaded;
    } catch (err) {
      logger.warn(`Failed to load plugin ${packageName}: ${(err as Error).message}. Continuing...`);
      return null;
    }
  }

  async function loadAll(app: import('express').Application, config: { plugins?: Array<{ package?: string; options?: Record<string, unknown> }> }): Promise<void> {
    const plugins = config.plugins || [];

    const pluginData = new Map<string, { plugin: Plugin; packageName: string; options: Record<string, unknown> }>();
    const loadOrder: string[] = [];
    const errors: string[] = [];

    for (const p of plugins) {
      const packageName = typeof p === 'string' ? p : p.package;
      if (!packageName) continue;

      if (loadedPlugins.has(packageName)) continue;

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
            const localPath = resolve(ROOT_DIR, 'packages', packageName.replace('@code-detective/', ''), 'src', 'index.js');
            const pluginModule = await import(localPath);
            plugin = (pluginModule as { default?: Plugin }).default || pluginModule as Plugin;
          }
        }
      } catch (err) {
        logger.warn(`Failed to load plugin metadata for ${packageName}: ${(err as Error).message}`);
        continue;
      }

      pluginData.set(packageName, {
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
      if (!data) return true;

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

    for (const name of loadOrder) {
      const data = pluginData.get(name)!;
      await loadPlugin(data.plugin, app, data.options);
    }
  }

  function getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(loadedPlugins.values());
  }

  return {
    loadPlugin,
    loadAll,
    getLoadedPlugins,
  };
}
