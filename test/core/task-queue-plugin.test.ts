import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createPluginSystem } from '../../src/core/plugin-system.js';
import type { AgentRunner, Plugin, TaskQueue } from '../../src/core/types.js';
import type { EventBus } from '@agent-detective/types';

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

describe('TaskQueue / registerTaskQueue', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = createNoopEventBus();
  });

  it('routes enqueue through a plugin-registered TaskQueue', async () => {
    const seen: string[] = [];
    const customQueue: TaskQueue = {
      enqueue: async (queueKey, fn) => {
        seen.push(`in:${queueKey}`);
        await fn();
        seen.push(`out:${queueKey}`);
      },
    };

    const queuePlugin: Plugin = {
      name: '@test/queue-plugin',
      version: '1.0.0',
      register(_app, context) {
        context.registerTaskQueue(customQueue);
      },
    };

    const pluginSystem = createPluginSystem({
      agentRunner: createMockAgentRunner(),
      events: eventBus,
      logger: console,
    });

    await pluginSystem.loadPlugin(queuePlugin, {} as never, {});

    await pluginSystem.enqueue('task-a', async () => {
      seen.push('work');
    });

    assert.deepEqual(seen, ['in:task-a', 'work', 'out:task-a']);
  });

  it('invokes shutdown on the previous queue when replaced', async () => {
    const shutdown = mock.fn();
    const first: TaskQueue = {
      enqueue: async (_k, fn) => {
        await fn();
      },
      shutdown,
    };
    const second: TaskQueue = {
      enqueue: async (_k, fn) => {
        await fn();
      },
    };

    const pluginSystem = createPluginSystem({
      agentRunner: createMockAgentRunner(),
      taskQueue: first,
      events: eventBus,
      logger: console,
    });

    const p: Plugin = {
      name: '@test/replace-queue',
      version: '1.0.0',
      register(_app, ctx) {
        ctx.registerTaskQueue(second);
      },
    };

    await pluginSystem.loadPlugin(p, {} as never, {});
    assert.equal(shutdown.mock.calls.length, 1);
  });
});
