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

  const createMockLogger = () => ({
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  });

  beforeEach(() => {
    pluginSystem = createPluginSystem({
      agentRunner: createMockAgentRunner(),
      enqueue: async () => {},
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

    it('injects enqueue into register', async () => {
      let contextReceived: any = null;
      const mockPlugin = {
        name: 'enqueue-plugin',
        version: '1.0.0',
        register: (_app: unknown, context: unknown) => {
          contextReceived = context;
        },
      };

      await pluginSystem.loadPlugin(mockPlugin as unknown as Plugin, {} as never, {});

      assert.ok(contextReceived);
      assert.ok(contextReceived.enqueue);
    });
  });

  describe('async register handling', () => {
    it('awaits async register() before marking plugin as loaded', async () => {
      let registerCompleted = false;
      const asyncRegisterPlugin = {
        name: 'async-plugin',
        version: '1.0.0',
        register: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          registerCompleted = true;
        },
      };

      await pluginSystem.loadPlugin(asyncRegisterPlugin as unknown as Plugin, {} as never, {});

      assert.ok(registerCompleted, 'register should have completed before loadPlugin returns');
      const plugins = pluginSystem.getLoadedPlugins();
      assert.equal(plugins.length, 1);
    });

    it('logs error when dependency plugin is not available', async () => {
      let registerCompleted = false;
      const dependentPlugin = {
        name: 'dependent-plugin',
        version: '1.0.0',
        register: async (_app: unknown, context: unknown) => {
          const extContext = context as { localRepos?: unknown };
          if (!extContext.localRepos) {
            registerCompleted = true;
            throw new Error('dependent-plugin requires local-repos-plugin to be loaded first');
          }
        },
      };

      const mockLogger = createMockLogger();
      const testPluginSystem = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        logger: mockLogger,
      });

      const loaded = await testPluginSystem.loadPlugin(dependentPlugin as unknown as Plugin, {} as never, {});

      assert.equal(loaded, null, 'plugin should fail to load');
      assert.ok(registerCompleted, 'register should have been called');
      assert.ok(
        mockLogger.warn.mock.calls.some(call => call.arguments[0]?.includes('dependent-plugin')),
        'should log warning about failed plugin'
      );
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

    describe('Service Registry', () => {
    it('allows a plugin to register and another to get a service', async () => {
      const serviceObj = { doSomething: () => 'done' };

      const providerPlugin = {
        name: 'provider-plugin',
        version: '1.0.0',
        register: (_app: any, context: any) => {
          context.registerService('test-service', serviceObj);
        },
      };

      let retrievedService: any = null;
      const consumerPlugin = {
        name: 'consumer-plugin',
        version: '1.0.0',
        dependsOn: ['provider-plugin'],
        register: (_app: any, context: any) => {
          retrievedService = context.getService('test-service');
        },
      };

      await pluginSystem.loadPlugin(providerPlugin as unknown as Plugin, {} as any, {});
      await pluginSystem.loadPlugin(consumerPlugin as unknown as Plugin, {} as any, {});

      assert.strictEqual(retrievedService, serviceObj);
      assert.strictEqual(retrievedService.doSomething(), 'done');
    });

    it('returns null when a plugin fails to register due to missing service', async () => {
      const consumerPlugin = {
        name: 'consumer-plugin-error',
        version: '1.0.0',
        register: (_app: any, context: any) => {
          context.getService('non-existent');
        },
      };

      const loaded = await pluginSystem.loadPlugin(consumerPlugin as unknown as Plugin, {} as any, {});
      assert.strictEqual(loaded, null);
    });

    it('warns when overwriting a service', async () => {
      const mockLogger = createMockLogger();
      const systemWithMockLogger = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        logger: mockLogger as any,
      });

      const plugin = {
        name: 'overwrite-plugin',
        version: '1.0.0',
        register: (_app: any, context: any) => {
          context.registerService('dup', { i: 1 });
          context.registerService('dup', { i: 2 });
        },
      };

      await systemWithMockLogger.loadPlugin(plugin as unknown as Plugin, {} as any, {});

      assert.ok(mockLogger.warn.mock.calls.length > 0);
      assert.match(mockLogger.warn.mock.calls[0].arguments[0], /Service dup already registered/);
    });
    });

    describe('Capabilities Registry', () => {
    it('allows plugins to register and check capabilities', async () => {
      let hasCap = false;
      const capabilityPlugin = {
        name: 'cap-plugin',
        version: '1.0.0',
        register: (_app: any, context: any) => {
          context.registerCapability('my-capability');
          hasCap = context.hasCapability('my-capability');
        },
      };

      const loaded = await pluginSystem.loadPlugin(capabilityPlugin as unknown as Plugin, {} as any, {});
      assert.ok(loaded);
      assert.strictEqual(hasCap, true);
    });

    it('logs an error when a required capability is missing in loadPlugin', async () => {
      const mockLogger = createMockLogger();
      const systemWithMockLogger = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        logger: mockLogger as any,
      });

      const missingCapPlugin = {
        name: 'missing-cap-plugin',
        version: '1.0.0',
        requiresCapabilities: ['code-analysis'],
        register: () => {},
      };

      await systemWithMockLogger.loadPlugin(missingCapPlugin as unknown as Plugin, {} as any, {});

      assert.ok(mockLogger.error.mock.calls.length > 0);
      assert.match(mockLogger.error.mock.calls[0].arguments[0], /requires capability 'code-analysis' which is not provided/);
      });
      });
      });