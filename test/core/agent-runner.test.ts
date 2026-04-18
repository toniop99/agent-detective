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
      const mockExecLocal = async (cmd: string, args: string[], opts: Record<string, unknown>) => {
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
});