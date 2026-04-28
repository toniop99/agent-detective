import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { createPluginSystem } from '../../src/core/plugin-system.js';
import type { AgentRunner, Plugin, TaskQueue } from '../../src/core/types.js';
import type { EventBus } from '@agent-detective/types';
import { CODE_ANALYSIS_SERVICE, StandardCapabilities } from '@agent-detective/sdk';

function createNoopEventBus(): EventBus {
  return {
    on: () => {},
    off: () => {},
    emit: () => {},
    invokeAsync: async () => [],
  };
}

function createMockAgentRunner(): AgentRunner {
  return {
    runAgentForChat: async () => ({ text: '', sawJson: false }),
    stopActiveRun: async () => ({ status: 'idle' }),
    registerAgent: mock.fn(),
    listAgents: async () => [],
    shutdown: () => {},
  };
}

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  };
}

function createTestApp(): FastifyInstance {
  return Fastify({ logger: false });
}

describe('Plugin System', () => {
  let pluginSystem: ReturnType<typeof createPluginSystem>;
  let app: FastifyInstance;

  beforeEach(() => {
    app = createTestApp();
    pluginSystem = createPluginSystem({
      agentRunner: createMockAgentRunner(),
      events: createNoopEventBus(),
      logger: createMockLogger(),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('loadPlugin', () => {
    it('loads a valid plugin', async () => {
      const mockPlugin: Plugin = {
        name: 'mock-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(mockPlugin, app, {});

      assert.ok(loaded);
      assert.equal(loaded?.name, 'mock-plugin');
      assert.equal(loaded?.version, '1.0.0');
    });

    it('returns null for invalid plugin without register', async () => {
      const invalidPlugin = {
        name: 'bad-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
      };

      const loaded = await pluginSystem.loadPlugin(invalidPlugin as unknown as Plugin, app, {});

      assert.equal(loaded, null);
    });

    it('returns null for plugin without name', async () => {
      const invalidPlugin = {
        version: '1.0.0',
        schemaVersion: '1.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(invalidPlugin as unknown as Plugin, app, {});

      assert.equal(loaded, null);
    });

    it('returns null for plugin without version', async () => {
      const invalidPlugin = {
        name: 'test-plugin',
        schemaVersion: '1.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(invalidPlugin as unknown as Plugin, app, {});

      assert.equal(loaded, null);
    });

    it('skips already loaded plugins', async () => {
      const mockPlugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: () => {},
      };

      await pluginSystem.loadPlugin(mockPlugin, app, {});
      await pluginSystem.loadPlugin(mockPlugin, app, {});

      assert.equal(pluginSystem.getLoadedPlugins().length, 1);
    });

    it('accepts plugin with schema version 1.0', async () => {
      const plugin: Plugin = {
        name: 'schema-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(plugin, app, {});

      assert.ok(loaded);
    });

    it('rejects plugin with invalid schema version', async () => {
      const plugin = {
        name: 'schema-plugin',
        version: '1.0.0',
        schemaVersion: '2.0',
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(plugin as unknown as Plugin, app, {});

      assert.equal(loaded, null);
    });
  });

  describe('loadAll', () => {
    it('returns early when no plugins config', async () => {
      await pluginSystem.loadAll(app, {} as never);
      assert.equal(pluginSystem.getLoadedPlugins().length, 0);
    });

    it('handles empty plugins array', async () => {
      const config = { plugins: [] };
      await pluginSystem.loadAll(app, config as never);
      assert.equal(pluginSystem.getLoadedPlugins().length, 0);
    });

    it('loads plugins in dependsOn topo order so services are available to dependents', async () => {
      const cfg = {
        plugins: [
          { package: './test/fixtures/plugins/provider-plugin.js', options: {} },
          { package: './test/fixtures/plugins/consumer-plugin.js', options: {} },
        ],
      };
      await pluginSystem.loadAll(app, cfg as never);

      // consumer-plugin sets a header on the provider's route; if it ran before
      // provider-plugin, it would throw and not be marked loaded.
      assert.equal(pluginSystem.getLoadedPlugins().some((p) => p.name === 'consumer-plugin'), true);
    });

    it('mounts plugin routes under /plugins/{sanitized-name}', async () => {
      const cfg = {
        plugins: [
          { package: './test/fixtures/plugins/prefix-plugin.js', options: {} },
        ],
      };

      await pluginSystem.loadAll(app, cfg as never);

      const res = await app.inject({ method: 'GET', url: '/plugins/scope-name/ping' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), { ok: true });
    });

    it('keeps Fastify hooks encapsulated per plugin scope', async () => {
      const cfg = {
        plugins: [
          { package: './test/fixtures/plugins/hook-a-plugin.js', options: {} },
          { package: './test/fixtures/plugins/hook-b-plugin.js', options: {} },
        ],
      };

      await pluginSystem.loadAll(app, cfg as never);

      const resA = await app.inject({ method: 'GET', url: '/plugins/hook-a-plugin/ping' });
      assert.equal(resA.statusCode, 200);
      assert.equal(resA.headers['x-plugin'], 'a');

      const resB = await app.inject({ method: 'GET', url: '/plugins/hook-b-plugin/ping' });
      assert.equal(resB.statusCode, 200);
      assert.equal(resB.headers['x-plugin'], 'b');
    });

    it('can be configured to fail startup on contract errors', async () => {
      const strict = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        events: createNoopEventBus(),
        logger: createMockLogger(),
        failOnContractErrors: true,
      });

      const cfg = {
        plugins: [
          { package: './test/fixtures/plugins/requires-code-analysis-plugin.js', options: {} },
        ],
      };

      await assert.rejects(
        () => strict.loadAll(app, cfg as never),
        /Plugin contract errors detected/,
      );
    });

    it('fails startup on dependency graph errors by default', async () => {
      const cfg = {
        plugins: [
          { package: './test/fixtures/plugins/bad-dep-plugin.js', options: {} },
        ],
      };

      await assert.rejects(
        () => pluginSystem.loadAll(app, cfg as never),
        /Plugin dependency errors detected/,
      );
    });
  });

  describe('getLoadedPlugins', () => {
    it('returns empty array initially', () => {
      const plugins = pluginSystem.getLoadedPlugins();
      assert.ok(Array.isArray(plugins));
      assert.equal(plugins.length, 0);
    });

    it('returns loaded plugins', async () => {
      const mockPlugin: Plugin = {
        name: 'loaded-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: () => {},
      };

      await pluginSystem.loadPlugin(mockPlugin, app, {});
      const plugins = pluginSystem.getLoadedPlugins();

      assert.equal(plugins.length, 1);
      assert.equal(plugins[0].name, 'loaded-plugin');
    });
  });

  describe('plugin context injection', () => {
    it('injects agentRunner into register', async () => {
      let contextReceived: unknown = null;
      const mockPlugin: Plugin = {
        name: 'context-test-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, context) => {
          contextReceived = context;
        },
      };

      await pluginSystem.loadPlugin(mockPlugin, app, {});

      assert.ok(contextReceived);
      assert.ok((contextReceived as { agentRunner?: unknown }).agentRunner);
    });

    it('injects enqueue and registerTaskQueue into register', async () => {
      let contextReceived: any = null;
      const mockPlugin: Plugin = {
        name: 'enqueue-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, context) => {
          contextReceived = context;
        },
      };

      await pluginSystem.loadPlugin(mockPlugin, app, {});

      assert.ok(contextReceived);
      assert.equal(typeof contextReceived.enqueue, 'function');
      assert.equal(typeof contextReceived.registerTaskQueue, 'function');
    });
  });

  describe('async register handling', () => {
    it('awaits async register() before marking plugin as loaded', async () => {
      let registerCompleted = false;
      const asyncRegisterPlugin: Plugin = {
        name: 'async-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          registerCompleted = true;
        },
      };

      await pluginSystem.loadPlugin(asyncRegisterPlugin, app, {});

      assert.ok(registerCompleted, 'register should have completed before loadPlugin returns');
      const plugins = pluginSystem.getLoadedPlugins();
      assert.equal(plugins.length, 1);
    });

    it('logs error when register throws', async () => {
      let registerCompleted = false;
      const dependentPlugin: Plugin = {
        name: 'dependent-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: async () => {
          registerCompleted = true;
          throw new Error('dependent-plugin requires local-repos-plugin to be loaded first');
        },
      };

      const mockLogger = createMockLogger();
      const testApp = createTestApp();
      const testPluginSystem = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        events: createNoopEventBus(),
        logger: mockLogger,
      });

      try {
        const loaded = await testPluginSystem.loadPlugin(dependentPlugin, testApp, {});

        assert.equal(loaded, null, 'plugin should fail to load');
        assert.ok(registerCompleted, 'register should have been called');
        assert.ok(
          mockLogger.warn.mock.calls.some(call => call.arguments[0]?.includes('dependent-plugin')),
          'should log warning about failed plugin'
        );
      } finally {
        await testApp.close();
      }
    });
  });

  describe('config merging', () => {
    it('merges plugin config with defaults', async () => {
      const mockPlugin: Plugin = {
        name: 'config-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        schema: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', default: true },
            timeout: { type: 'number', default: 5000 },
          },
          required: [],
        },
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(
        mockPlugin,
        app,
        { enabled: false }
      );

      assert.ok(loaded);
    });

    it('applies default values when not provided in config', async () => {
      const mockPlugin: Plugin = {
        name: 'defaults-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        schema: {
          type: 'object',
          properties: {
            option1: { type: 'string', default: 'default-value' },
          },
          required: [],
        },
        register: () => {},
      };

      const loaded = await pluginSystem.loadPlugin(mockPlugin, app, {});

      assert.ok(loaded);
    });
  });

  describe('Service Registry', () => {
    it('allows a plugin to register and another to get a service', async () => {
      const serviceObj = { doSomething: () => 'done' };

      const providerPlugin: Plugin = {
        name: 'provider-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, context) => {
          (context as any).registerService('test-service', serviceObj);
        },
      };

      let retrievedService: any = null;
      const consumerPlugin: Plugin = {
        name: 'consumer-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        dependsOn: ['provider-plugin'],
        register: (_scope, context) => {
          retrievedService = (context as any).getService('test-service');
        },
      };

      await pluginSystem.loadPlugin(providerPlugin, app, {});
      await pluginSystem.loadPlugin(consumerPlugin, app, {});

      assert.strictEqual(retrievedService, serviceObj);
      assert.strictEqual(retrievedService.doSomething(), 'done');
    });

    it('returns null when a plugin fails to register due to missing service', async () => {
      const consumerPlugin: Plugin = {
        name: 'consumer-plugin-error',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, context) => {
          (context as any).getService('non-existent');
        },
      };

      const loaded = await pluginSystem.loadPlugin(consumerPlugin, app, {});
      assert.strictEqual(loaded, null);
    });

    it('warns when overwriting a service', async () => {
      const mockLogger = createMockLogger();
      const testApp = createTestApp();
      const systemWithMockLogger = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        events: createNoopEventBus(),
        logger: mockLogger,
      });

      const plugin: Plugin = {
        name: 'overwrite-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, context) => {
          (context as any).registerService('dup', { i: 1 });
          (context as any).registerService('dup', { i: 2 });
        },
      };

      try {
        await systemWithMockLogger.loadPlugin(plugin, testApp, {});

        assert.ok(mockLogger.warn.mock.calls.length > 0);
        assert.match(mockLogger.warn.mock.calls[0].arguments[0], /Service dup already registered/);
      } finally {
        await testApp.close();
      }
    });
  });

  describe('Capabilities Registry', () => {
    it('allows plugins to register and check capabilities', async () => {
      let hasCap = false;
      const capabilityPlugin: Plugin = {
        name: 'cap-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, context) => {
          (context as any).registerCapability('my-capability');
          hasCap = (context as any).hasCapability('my-capability');
        },
      };

      const loaded = await pluginSystem.loadPlugin(capabilityPlugin, app, {});
      assert.ok(loaded);
      assert.strictEqual(hasCap, true);
    });

    it('logs an error when a required capability is missing in loadPlugin', async () => {
      const mockLogger = createMockLogger();
      const testApp = createTestApp();
      const systemWithMockLogger = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        events: createNoopEventBus(),
        logger: mockLogger,
      });

      const missingCapPlugin: Plugin = {
        name: 'missing-cap-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        requiresCapabilities: [StandardCapabilities.CODE_ANALYSIS],
        register: () => {},
      };

      try {
        await systemWithMockLogger.loadPlugin(missingCapPlugin, testApp, {});

        assert.ok(mockLogger.error.mock.calls.length > 0);
        assert.match(mockLogger.error.mock.calls[0].arguments[0], /requires capability 'code-analysis' which is not provided/);
        assert.match(mockLogger.error.mock.calls[0].arguments[0], /Available capabilities: \(none\)/);
      } finally {
        await testApp.close();
      }
    });
  });

  describe('Service registry (multi-provider)', () => {
    it('prefers first-party provider when multiple providers register the same capability-backed service', async () => {
      let selectedProvider: string | null = null;

      const thirdPartyProvider: Plugin = {
        name: 'acme.example/analysis',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, ctx) => {
          ctx.registerService(CODE_ANALYSIS_SERVICE, { provider: 'third-party' });
        },
      };

      const firstPartyProvider: Plugin = {
        name: '@agent-detective/analysis',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, ctx) => {
          ctx.registerService(CODE_ANALYSIS_SERVICE, { provider: 'first-party' });
        },
      };

      const consumer: Plugin = {
        name: 'consumer',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, ctx) => {
          const svc = ctx.getService<{ provider: string }>(CODE_ANALYSIS_SERVICE);
          selectedProvider = svc.provider;
        },
      };

      await pluginSystem.loadPlugin(thirdPartyProvider, app, {});
      await pluginSystem.loadPlugin(firstPartyProvider, app, {});
      await pluginSystem.loadPlugin(consumer, app, {});

      assert.equal(selectedProvider, 'first-party');
    });

    it('allows binding to a specific provider via getServiceFromPlugin', async () => {
      let selectedProvider: string | null = null;

      const provider: Plugin = {
        name: '@agent-detective/analysis',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: (_scope, ctx) => {
          ctx.registerService(CODE_ANALYSIS_SERVICE, { provider: 'first-party' });
        },
      };

      const consumer: Plugin = {
        name: 'consumer',
        version: '1.0.0',
        schemaVersion: '1.0',
        dependsOn: ['@agent-detective/analysis'],
        register: (_scope, ctx) => {
          const svc = ctx.getServiceFromPlugin<{ provider: string }>(CODE_ANALYSIS_SERVICE, '@agent-detective/analysis');
          selectedProvider = svc.provider;
        },
      };

      await pluginSystem.loadPlugin(provider, app, {});
      await pluginSystem.loadPlugin(consumer, app, {});

      assert.equal(selectedProvider, 'first-party');
    });

    it('throws a clear error when getServiceFromPlugin provider is missing', async () => {
      const consumer: Plugin = {
        name: 'consumer',
        version: '1.0.0',
        schemaVersion: '1.0',
        dependsOn: ['@agent-detective/analysis'],
        register: (_scope, ctx) => {
          ctx.getServiceFromPlugin(CODE_ANALYSIS_SERVICE, '@agent-detective/analysis');
        },
      };

      const loaded = await pluginSystem.loadPlugin(consumer, app, {});
      assert.equal(loaded, null);
    });
  });

  describe('Task queue integration', () => {
    it('defaults to in-memory queue: returned enqueue serializes same key', async () => {
      const ps = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        events: createNoopEventBus(),
        logger: createMockLogger(),
      });
      const order: string[] = [];
      await ps.enqueue('k', async () => {
        order.push('a-start');
        await delay(25);
        order.push('a-end');
      });
      await ps.enqueue('k', async () => {
        order.push('b');
      });
      await delay(60);
      assert.deepEqual(order, ['a-start', 'a-end', 'b']);
    });

    it('uses taskQueue option when provided', async () => {
      let usedCustom = false;
      const custom: TaskQueue = {
        enqueue: async (_key, fn) => {
          usedCustom = true;
          await fn();
        },
      };
      const ps = createPluginSystem({
        agentRunner: createMockAgentRunner(),
        events: createNoopEventBus(),
        taskQueue: custom,
        logger: createMockLogger(),
      });
      await ps.enqueue('x', async () => {});
      assert.ok(usedCustom);
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
