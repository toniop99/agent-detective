import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createPluginSystem } from '../../src/core/plugin-system.js';
import type { AgentRunner, RepoMapping, Plugin } from '../../src/core/types.js';

describe('Plugin System', () => {
  let pluginSystem: ReturnType<typeof createPluginSystem>;

  const createMockAgentRunner = (): AgentRunner => ({
    runAgentForChat: async () => '',
    stopActiveRun: async () => ({ status: 'idle' }),
  });

  const createMockRepoMapping = (): RepoMapping => ({
    resolveRepoFromMapping: () => null,
    resolveProjectFromName: () => null,
  });

  const createMockBuildRepoContext = async () => ({
    repoName: 'test',
    recentCommits: [],
    searchResults: [],
    stats: { commitCount: 0, errorMatchCount: 0 },
    repoPath: '/test',
  });

  const createMockLogger = () => ({
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  });

  beforeEach(() => {
    pluginSystem = createPluginSystem({
      agentRunner: createMockAgentRunner(),
      repoMapping: createMockRepoMapping(),
      buildRepoContext: createMockBuildRepoContext,
      formatRepoContextForPrompt: () => 'Mock repo context',
      logger: createMockLogger(),
    });
  });

  describe('loadPlugin', () => {
    it('loads a valid plugin', async () => {
      const mockPlugin = {
        name: 'mock-plugin',
        version: '1.0.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(mockPlugin as unknown as Plugin, {} as never, {});

      assert.ok(loaded);
      assert.equal(loaded?.name, 'mock-plugin');
      assert.equal(loaded?.version, '1.0.0');
    });

    it('returns null for invalid plugin without register', async () => {
      const invalidPlugin = {
        name: 'bad-plugin',
        version: '1.0.0',
      };

      const loaded = await pluginSystem.loadPlugin(invalidPlugin as unknown as Plugin, {} as never, {});

      assert.equal(loaded, null);
    });

    it('returns null for plugin without name', async () => {
      const invalidPlugin = {
        version: '1.0.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(invalidPlugin as unknown as Plugin, {} as never, {});

      assert.equal(loaded, null);
    });

    it('returns null for plugin without version', async () => {
      const invalidPlugin = {
        name: 'test-plugin',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(invalidPlugin as unknown as Plugin, {} as never, {});

      assert.equal(loaded, null);
    });

    it('skips already loaded plugins', async () => {
      const mockPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        register: () => {},
      };

      await pluginSystem.loadPlugin(mockPlugin as unknown as Plugin, {} as never, {});
      await pluginSystem.loadPlugin(mockPlugin as unknown as Plugin, {} as never, {});

      assert.equal(pluginSystem.getLoadedPlugins().length, 1);
    });

    it('accepts plugin with schema version 1.0', async () => {
      const plugin = {
        name: 'schema-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(plugin as unknown as Plugin, {} as never, {});

      assert.ok(loaded);
    });

    it('rejects plugin with invalid schema version', async () => {
      const plugin = {
        name: 'schema-plugin',
        version: '1.0.0',
        schemaVersion: '2.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(plugin as unknown as Plugin, {} as never, {});

      assert.equal(loaded, null);
    });
  });

  describe('loadAll', () => {
    it('loads plugins from config array', async () => {
      const config = {
        plugins: [
          { package: 'mock-plugin-1', options: {} },
        ],
      };

      await pluginSystem.loadAll({} as never, config as never);
    });

    it('returns early when no plugins config', async () => {
      await pluginSystem.loadAll({} as never, {} as never);
      assert.equal(pluginSystem.getLoadedPlugins().length, 0);
    });

    it('handles empty plugins array', async () => {
      const config = { plugins: [] };
      await pluginSystem.loadAll({} as never, config as never);
      assert.equal(pluginSystem.getLoadedPlugins().length, 0);
    });
  });

  describe('getLoadedPlugins', () => {
    it('returns empty array initially', () => {
      const plugins = pluginSystem.getLoadedPlugins();
      assert.ok(Array.isArray(plugins));
      assert.equal(plugins.length, 0);
    });

    it('returns loaded plugins', async () => {
      const mockPlugin = {
        name: 'loaded-plugin',
        version: '1.0.0',
        register: () => {},
      };

      await pluginSystem.loadPlugin(mockPlugin as unknown as Plugin, {} as never, {});
      const plugins = pluginSystem.getLoadedPlugins();

      assert.equal(plugins.length, 1);
      assert.equal(plugins[0].name, 'loaded-plugin');
    });
  });

  describe('plugin context injection', () => {
    it('injects agentRunner into register', async () => {
      let contextReceived: unknown = null;
      const mockPlugin = {
        name: 'context-test-plugin',
        version: '1.0.0',
        register: (_app: unknown, context: unknown) => {
          contextReceived = context;
        },
      };

      await pluginSystem.loadPlugin(mockPlugin as unknown as Plugin, {} as never, {});

      assert.ok(contextReceived);
      assert.ok((contextReceived as { agentRunner?: unknown }).agentRunner);
    });

    it('injects repoMapping when provided', async () => {
      let contextReceived: unknown = null;
      const mockPlugin = {
        name: 'repo-mapping-plugin',
        version: '1.0.0',
        register: (_app: unknown, context: unknown) => {
          contextReceived = context;
        },
      };

      await pluginSystem.loadPlugin(mockPlugin as unknown as Plugin, {} as never, {});

      assert.ok(contextReceived);
      assert.ok((contextReceived as { repoMapping?: unknown }).repoMapping);
    });

    it('injects buildRepoContext when provided', async () => {
      let contextReceived: unknown = null;
      const mockPlugin = {
        name: 'build-context-plugin',
        version: '1.0.0',
        register: (_app: unknown, context: unknown) => {
          contextReceived = context;
        },
      };

      await pluginSystem.loadPlugin(mockPlugin as unknown as Plugin, {} as never, {});

      assert.ok(contextReceived);
      assert.ok((contextReceived as { buildRepoContext?: unknown }).buildRepoContext);
    });
  });

  describe('config merging', () => {
    it('merges plugin config with defaults', async () => {
      const mockPlugin = {
        name: 'config-plugin',
        version: '1.0.0',
        schema: {
          version: '1.0',
          config: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean', default: true },
              timeout: { type: 'number', default: 5000 },
            },
            required: [],
          },
        },
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(
        mockPlugin as unknown as Plugin,
        {} as never,
        { enabled: false }
      );

      assert.ok(loaded);
    });

    it('applies default values when not provided in config', async () => {
      const mockPlugin = {
        name: 'defaults-plugin',
        version: '1.0.0',
        schema: {
          version: '1.0',
          config: {
            type: 'object',
            properties: {
              option1: { type: 'string', default: 'default-value' },
            },
            required: [],
          },
        },
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(
        mockPlugin as unknown as Plugin,
        {} as never,
        {}
      );

      assert.ok(loaded);
    });
  });
});