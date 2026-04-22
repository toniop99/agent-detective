import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Agent } from '../../src/core/types.js';
import { createAgentRunner } from '../../src/core/agent-runner.js';

describe('agent-runner', () => {
  const createMockAgent = (overrides: Partial<Agent> = {}): Agent => ({
    id: 'test-agent',
    label: 'Test Agent',
    command: 'test-cmd',
    parseOutput: () => ({ text: 'mock-output', sawJson: false }),
    ...overrides,
  });

  describe('createAgentRunner', () => {
    it('creates agent runner with default options', () => {
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });

      assert.ok(runner);
      assert.ok(typeof runner.runAgentForChat === 'function');
      assert.ok(typeof runner.stopActiveRun === 'function');
      assert.ok(typeof runner.registerAgent === 'function');
      assert.ok(typeof runner.listAgents === 'function');
    });

    it('creates agent runner with custom options', () => {
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
        agentTimeoutMs: 60000,
        agentMaxBuffer: 5 * 1024 * 1024,
        postFinalGraceMs: 60000,
      });

      assert.ok(runner);
    });
  });

  describe('runAgentForChat', () => {
    it('throws error for unknown agent', async () => {
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });

      await assert.rejects(
        () => runner.runAgentForChat('task-1', 'test prompt'),
        (err: Error) => {
          assert.ok(err.message.includes('Unknown agent'));
          return true;
        }
      );
    });

    it('returns idle when run completes successfully', async () => {
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });
      runner.registerAgent(createMockAgent({ id: 'opencode' }));

      await runner.runAgentForChat('task-1', 'test prompt');
      const result = await runner.stopActiveRun('task-1');
      assert.equal(result.status, 'idle');
    });

    it('handles execLocal returning empty string', async () => {
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });
      runner.registerAgent(createMockAgent({ id: 'opencode', parseOutput: () => ({ text: '', sawJson: false }) }));

      const result = await runner.runAgentForChat('task-1', 'test prompt');
      assert.equal(result, '');
    });

    it('passes cwd option to execLocal', async () => {
      const mockExecLocal = async (_cmd: string, _args: string[], opts: Record<string, unknown>) => {
        return opts?.cwd as string || '';
      };

      const runner = createAgentRunner({
        execLocal: mockExecLocal as unknown as (...args: unknown[]) => Promise<string>,
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });
      runner.registerAgent(createMockAgent({ id: 'opencode' }));

      await runner.runAgentForChat('task-1', 'test prompt', { cwd: '/custom/path' });
      const stopResult = await runner.stopActiveRun('task-1');
      assert.equal(stopResult.status, 'idle');
    });
  });

  describe('runShellAgent', () => {
    it('passes model override to buildCommand', async () => {
      let usedModel: string | undefined;
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });
      runner.registerAgent(createMockAgent({
        id: 'opencode',
        buildCommand: (opts: { model?: string }) => {
          usedModel = opts.model;
          return 'test-cmd';
        },
      }));

      await runner.runAgentForChat('task-1', 'test prompt', {
        model: 'custom-model',
      });

      assert.equal(usedModel, 'custom-model');
    });

    it('uses agent defaultModel when no override', async () => {
      let usedModel: string | undefined;
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });
      runner.registerAgent(createMockAgent({
        id: 'opencode',
        defaultModel: 'default-model',
        buildCommand: (opts: { model?: string }) => {
          usedModel = opts.model;
          return 'test-cmd';
        },
      }));

      await runner.runAgentForChat('task-1', 'test prompt');

      assert.equal(usedModel, 'default-model');
    });

    it('passes threadId to buildCommand', async () => {
      let usedThread: string | undefined;
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });
      runner.registerAgent(
        createMockAgent({
          id: 'opencode',
          buildCommand: (opts: { threadId?: string }) => {
            usedThread = opts.threadId;
            return 'test-cmd';
          },
        })
      );

      await runner.runAgentForChat('task-1', 'test prompt', { threadId: 'sess-abc' });
      assert.equal(usedThread, 'sess-abc');
    });
  });

  describe('stopActiveRun', () => {
    it('returns idle when no active run', async () => {
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });

      const result = await runner.stopActiveRun('nonexistent-task');
      assert.equal(result.status, 'idle');
    });

    it('returns idle for completed run', async () => {
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });
      runner.registerAgent(createMockAgent({ id: 'opencode' }));

      await runner.runAgentForChat('task-1', 'test prompt');
      const result = await runner.stopActiveRun('task-1');
      assert.equal(result.status, 'idle');
    });
  });

  describe('active run tracking', () => {
    it('allows stopping after completion', async () => {
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => '',
        terminateChildProcess: () => {},
      });
      runner.registerAgent(createMockAgent({ id: 'opencode' }));

      await runner.runAgentForChat('task-1', 'test prompt');
      const result = await runner.stopActiveRun('task-1');

      assert.equal(result.status, 'idle');
    });
  });

  describe('singleInstance agents', () => {
    // The runner always takes the streaming path (`canStream` is always true
    // because emitProgress is always a function in runAgentForChat), so our
    // stub must wrap `execLocalStreaming`, not `execLocal`.
    function makeGatedStreamingExec(): {
      exec: (cmd: string, args: string[], opts: Record<string, unknown>) => Promise<string>;
      starts: string[];
      releaseNext: () => void;
    } {
      const starts: string[] = [];
      const pending: Array<() => void> = [];
      const exec = async (cmd: string, _args: string[], _opts: Record<string, unknown>) => {
        starts.push(cmd);
        await new Promise<void>((resolve) => {
          pending.push(resolve);
        });
        return '';
      };
      const releaseNext = (): void => {
        const resolve = pending.shift();
        if (resolve) resolve();
      };
      return { exec, starts, releaseNext };
    }

    // A couple of microtasks is not enough — the runner does several awaits
    // between runAgentForChat() and execLocalStreaming(). `setImmediate`
    // clears the current task queue, so a few of them reliably let every
    // pending `await` in the runner progress to the spawn point.
    async function settle(times = 5): Promise<void> {
      for (let i = 0; i < times; i += 1) {
        await new Promise((r) => setImmediate(r));
      }
    }

    it('serializes concurrent runs of a singleInstance agent (opencode-style)', async () => {
      const { exec, starts, releaseNext } = makeGatedStreamingExec();
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: exec as unknown as (...args: unknown[]) => Promise<string>,
        terminateChildProcess: () => {},
      });
      runner.registerAgent(
        createMockAgent({
          id: 'opencode',
          singleInstance: true,
          buildCommand: () => 'opencode-cmd',
        })
      );

      const first = runner.runAgentForChat('task-a', 'p1');
      const second = runner.runAgentForChat('task-b', 'p2');

      await settle();
      assert.equal(starts.length, 1, 'second run must not start until the first releases its slot');

      releaseNext();
      await first;
      await settle();
      assert.equal(starts.length, 2, 'second run should start once the first has finished');

      releaseNext();
      await second;
    });

    it('does NOT serialize runs across different agents', async () => {
      const { exec, starts, releaseNext } = makeGatedStreamingExec();
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: exec as unknown as (...args: unknown[]) => Promise<string>,
        terminateChildProcess: () => {},
      });
      runner.registerAgent(
        createMockAgent({
          id: 'opencode',
          singleInstance: true,
          buildCommand: () => 'opencode-cmd',
        })
      );
      runner.registerAgent(
        createMockAgent({
          id: 'other-agent',
          singleInstance: true,
          buildCommand: () => 'other-cmd',
        })
      );

      const first = runner.runAgentForChat('task-a', 'p1', { agentId: 'opencode' });
      const second = runner.runAgentForChat('task-b', 'p2', { agentId: 'other-agent' });

      await settle();
      assert.equal(starts.length, 2, 'different agents have independent serialization chains');

      releaseNext();
      releaseNext();
      await Promise.all([first, second]);
    });

    it('runs without singleInstance flag go in parallel (no serialization)', async () => {
      const { exec, starts, releaseNext } = makeGatedStreamingExec();
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: exec as unknown as (...args: unknown[]) => Promise<string>,
        terminateChildProcess: () => {},
      });
      runner.registerAgent(
        createMockAgent({
          id: 'opencode',
          buildCommand: () => 'opencode-cmd',
        })
      );

      const first = runner.runAgentForChat('task-a', 'p1');
      const second = runner.runAgentForChat('task-b', 'p2');

      await settle();
      assert.equal(starts.length, 2, 'without singleInstance, both runs should spawn immediately');

      releaseNext();
      releaseNext();
      await Promise.all([first, second]);
    });

    it('releases the slot even if the run throws, letting the next waiter proceed', async () => {
      let spawns = 0;
      const runner = createAgentRunner({
        execLocal: async () => '',
        execLocalStreaming: async () => {
          spawns += 1;
          if (spawns === 1) {
            throw new Error('boom');
          }
          return '';
        },
        terminateChildProcess: () => {},
      });
      runner.registerAgent(
        createMockAgent({
          id: 'opencode',
          singleInstance: true,
          buildCommand: () => 'opencode-cmd',
        })
      );

      await assert.rejects(() => runner.runAgentForChat('task-a', 'p1'), /boom/);
      await runner.runAgentForChat('task-b', 'p2');
      assert.equal(spawns, 2);
    });
  });
});