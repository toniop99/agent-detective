import { describe, it } from 'node:test';
import assert from 'node:assert';
import opencodeAgent from '../../src/agents/opencode.js';
import claudeAgent from '../../src/agents/claude.js';
import cursorAgent from '../../src/agents/cursor.js';
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

    it('uses full permission set by default', () => {
      const cmd = opencodeAgent.buildCommand!({
        prompt: 'Hello world',
        promptExpression: '"$PROMPT"',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.includes('OPENCODE_PERMISSION='), 'must set OPENCODE_PERMISSION');
      assert.ok(cmd.includes('"*": "allow"'), 'default permission must allow all tools');
      assert.ok(!cmd.includes('"deny"'), 'no deny entries in the default mode');
    });

    it('denies write/edit/shell tools when readOnly=true', () => {
      const cmd = opencodeAgent.buildCommand!({
        prompt: 'Investigate only',
        promptExpression: '"$PROMPT"',
        model: undefined,
        thinking: undefined,
        readOnly: true,
      });
      assert.ok(cmd.includes('OPENCODE_PERMISSION='), 'must set OPENCODE_PERMISSION');
      for (const tool of ['bash', 'edit', 'write', 'multiedit', 'patch']) {
        assert.ok(
          cmd.includes(`"${tool}":"deny"`),
          `read-only command must deny tool "${tool}" (got: ${cmd})`
        );
      }
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

  describe('cursor agent', () => {
    it('builds command with default model and json output', () => {
      const cmd = cursorAgent.buildCommand!({
        prompt: 'Hello',
        promptExpression: '"$PROMPT"',
        model: undefined,
        thinking: undefined,
      });
      assert.ok(cmd.startsWith('agent '));
      assert.ok(cmd.includes('-p'));
      assert.ok(cmd.includes('--output-format'));
      assert.ok(cmd.includes('json'));
      assert.ok(cmd.includes('--model'));
      assert.ok(cmd.includes('gpt-5.2'));
    });

    it('adds readOnly via --mode=ask', () => {
      const cmd = cursorAgent.buildCommand!({
        prompt: 'Read only',
        promptExpression: '"$PROMPT"',
        readOnly: true,
        model: 'gpt-5.2',
        thinking: undefined,
      });
      assert.ok(cmd.includes('--mode=ask'));
    });

    it('adds --resume for threadId', () => {
      const cmd = cursorAgent.buildCommand!({
        prompt: 'Cont',
        promptExpression: '"$PROMPT"',
        threadId: 'c6b62c6f-7ead-4fd6-9922-e952131177ff',
        model: 'gpt-5.2',
        thinking: undefined,
      });
      assert.ok(cmd.includes('--resume'));
      assert.ok(cmd.includes('c6b62c6f-7ead-4fd6-9922-e952131177ff'));
    });

    it('parses JSON result from Cursor Agent CLI', () => {
      const output = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 1234,
        result: 'Full assistant text',
        session_id: 'c6b62c6f-7ead-4fd6-9922-e952131177ff',
      });
      const parsed = cursorAgent.parseOutput!(output);
      assert.equal(parsed.text, 'Full assistant text');
      assert.equal(parsed.threadId, 'c6b62c6f-7ead-4fd6-9922-e952131177ff');
      assert.ok(parsed.sawJson);
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
      assert.ok(isKnownAgent('cursor'));
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
      assert.equal(agents.length, 3);
      const ids = new Set(agents.map((a) => a.id));
      assert.ok(ids.has('opencode'));
      assert.ok(ids.has('claude'));
      assert.ok(ids.has('cursor'));
    });

    it('isAgentInstalled checks command availability', () => {
      const opencodeInstalled = isAgentInstalled('opencode');
      assert.ok(typeof opencodeInstalled === 'boolean');
    });
  });
});
