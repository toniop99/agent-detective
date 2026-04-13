import { describe, it } from 'node:test';
import assert from 'node:assert';
import opencodeAgent from '../../src/agents/opencode.js';
import claudeAgent from '../../src/agents/claude.js';
import codexAgent from '../../src/agents/codex.js';
import geminiAgent from '../../src/agents/gemini.js';
import {
  normalizeAgent,
  isKnownAgent,
  getAgent,
  getAgentLabel,
  listAgents,
  isAgentInstalled,
  DEFAULT_AGENT,
} from '../../src/agents/index.js';

describe('agents', () => {
  describe('opencode agent', () => {
    it('builds command with default model', () => {
      const cmd = opencodeAgent.buildCommand!({
        prompt: 'Hello world',
        promptExpression: '"$PROMPT"',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.includes('opencode'));
      assert.ok(cmd.includes('--model'));
      assert.ok(cmd.includes('opencode/gpt-5-nano'));
    });

    it('builds command with custom model', () => {
      const cmd = opencodeAgent.buildCommand!({
        prompt: 'Hello world',
        promptExpression: '"$PROMPT"',
        model: 'gpt-4',
        thinking: undefined,
      });
      assert.ok(cmd.includes('--model'));
      assert.ok(cmd.includes('gpt-4'));
    });

    it('builds command with threadId for resume', () => {
      const cmd = opencodeAgent.buildCommand!({
        prompt: 'Continue',
        promptExpression: '"$PROMPT"',
        threadId: 'session-123',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.includes('--continue'));
      assert.ok(cmd.includes('--session'));
      assert.ok(cmd.includes('session-123'));
    });

    it('parses JSON output correctly', () => {
      const output = JSON.stringify({
        type: 'text',
        part: { text: 'Hello from opencode' },
        sessionID: 'abc-123',
      });
      const parsed = opencodeAgent.parseOutput!(output);
      assert.equal(parsed.text, 'Hello from opencode');
      assert.equal(parsed.threadId, 'abc-123');
      assert.ok(parsed.sawJson);
    });

    it('returns raw text when no JSON', () => {
      const output = 'Plain text response';
      const parsed = opencodeAgent.parseOutput!(output);
      assert.equal(parsed.text, 'Plain text response');
      assert.ok(!parsed.sawJson);
    });
  });

  describe('claude agent', () => {
    it('builds command with default model', () => {
      const cmd = claudeAgent.buildCommand!({
        prompt: 'Hello world',
        promptExpression: '"$PROMPT"',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.includes('claude'));
      assert.ok(cmd.includes('-p'));
      assert.ok(cmd.includes('--output-format'));
      assert.ok(cmd.includes('json'));
    });

    it('builds command with custom model', () => {
      const cmd = claudeAgent.buildCommand!({
        prompt: 'Hello world',
        promptExpression: '"$PROMPT"',
        model: 'claude-3-opus',
        thinking: undefined,
      });
      assert.ok(cmd.includes('--model'));
      assert.ok(cmd.includes('claude-3-opus'));
    });

    it('builds command with valid threadId', () => {
      const cmd = claudeAgent.buildCommand!({
        prompt: 'Continue',
        promptExpression: '"$PROMPT"',
        threadId: '12345678-1234-4234-a234-123456789012',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.includes('--resume'));
    });

    it('strips ANSI codes from output', () => {
      const output = '\x1B[31mRed text\x1B[0m normal';
      const cleaned = claudeAgent.parseOutput!(output);
      assert.ok(!cleaned.text.includes('\x1B['));
    });

    it('parses JSON output correctly', () => {
      const output = JSON.stringify({
        result: 'Claude response text',
        session_id: '12345678-1234-5234-8234-123456789012',
      });
      const parsed = claudeAgent.parseOutput!(output);
      assert.equal(parsed.text, 'Claude response text');
      assert.equal(parsed.threadId, '12345678-1234-5234-8234-123456789012');
      assert.ok(parsed.sawJson);
    });

    it('parses streaming output', () => {
      const output = JSON.stringify({
        result: 'Streaming response',
        session_id: 'stream-123',
      });
      const parsed = claudeAgent.parseStreamingOutput!(output);
      assert.ok(parsed.sawFinal);
      assert.ok(parsed.text.includes('Streaming response'));
    });
  });

  describe('codex agent', () => {
    it('builds command with default args', () => {
      const cmd = codexAgent.buildCommand!({
        prompt: 'Hello world',
        promptExpression: '"$PROMPT"',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.includes('codex'));
      assert.ok(cmd.includes('exec'));
      assert.ok(cmd.includes('--json'));
      assert.ok(cmd.includes('--skip-git-repo-check'));
    });

    it('builds command with custom model', () => {
      const cmd = codexAgent.buildCommand!({
        prompt: 'Hello world',
        promptExpression: '"$PROMPT"',
        model: 'gpt-4',
        thinking: undefined,
      });
      assert.ok(cmd.includes('--model'));
      assert.ok(cmd.includes('gpt-4'));
    });

    it('builds resume command with threadId', () => {
      const cmd = codexAgent.buildCommand!({
        prompt: 'Continue',
        promptExpression: '"$PROMPT"',
        threadId: 'session-456',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.includes('resume'));
      assert.ok(cmd.includes('session-456'));
    });

    it('parses JSON output with final message', () => {
      const output = JSON.stringify({
        type: 'item.completed',
        item: { type: 'message', text: 'Codex response', channel: 'final' },
      });
      const parsed = codexAgent.parseOutput!(output);
      assert.ok(parsed.text.includes('Codex response'));
      assert.ok(parsed.sawJson);
    });

    it('parses streaming output', () => {
      const output = JSON.stringify({
        type: 'item.completed',
        item: { type: 'message', text: 'Streaming', channel: 'final' },
      });
      const parsed = codexAgent.parseStreamingOutput!(output);
      assert.ok(parsed.sawFinal);
      assert.ok(parsed.commentaryMessages);
    });
  });

  describe('gemini agent', () => {
    it('has required properties', () => {
      assert.ok(geminiAgent.id);
      assert.ok(geminiAgent.label);
      assert.ok(geminiAgent.command);
    });

    it('builds command', () => {
      const cmd = geminiAgent.buildCommand!({
        prompt: 'Hello',
        promptExpression: '"$PROMPT"',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.includes('gemini'));
    });
  });

  describe('agent utilities', () => {
    it('normalizeAgent returns default for undefined', () => {
      assert.equal(normalizeAgent(undefined), DEFAULT_AGENT);
    });

    it('normalizeAgent returns default for empty string', () => {
      assert.equal(normalizeAgent(''), DEFAULT_AGENT);
    });

    it('normalizeAgent returns normalized known agent', () => {
      assert.equal(normalizeAgent('CLAUDE'), 'claude');
      assert.equal(normalizeAgent('OpenCode'), 'opencode');
    });

    it('normalizeAgent returns default for unknown agent', () => {
      assert.equal(normalizeAgent('unknown-agent'), DEFAULT_AGENT);
    });

    it('isKnownAgent returns true for known agents', () => {
      assert.ok(isKnownAgent('opencode'));
      assert.ok(isKnownAgent('claude'));
      assert.ok(isKnownAgent('codex'));
      assert.ok(isKnownAgent('gemini'));
    });

    it('isKnownAgent returns false for unknown agents', () => {
      assert.ok(!isKnownAgent('unknown'));
      assert.ok(!isKnownAgent(''));
      assert.ok(!isKnownAgent(undefined));
    });

    it('getAgent returns agent by id', () => {
      const agent = getAgent('claude');
      assert.ok(agent);
      assert.equal(agent.id, 'claude');
    });

    it('getAgent returns default agent for unknown', () => {
      const agent = getAgent('nonexistent');
      assert.ok(agent);
      assert.equal(agent.id, DEFAULT_AGENT);
    });

    it('getAgentLabel returns label', () => {
      assert.equal(getAgentLabel('claude'), 'claude');
    });

    it('listAgents returns all agents', () => {
      const agents = listAgents();
      assert.ok(agents.length >= 4);
      const ids = agents.map((a) => a.id);
      assert.ok(ids.includes('opencode'));
      assert.ok(ids.includes('claude'));
      assert.ok(ids.includes('codex'));
      assert.ok(ids.includes('gemini'));
    });

    it('isAgentInstalled checks command availability', () => {
      const opencodeInstalled = isAgentInstalled('opencode');
      assert.ok(typeof opencodeInstalled === 'boolean');
    });
  });
});