import { shellQuote, resolvePromptValue } from './utils.js';
import type { Agent, AgentOutput } from '../core/types.js';

const CLAUDE_CMD = 'claude';
const CLAUDE_OUTPUT_FORMAT = 'json';
const CLAUDE_SESSION_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stripAnsi(value: string): string {
  return String(value || '')
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '');
}

function sanitizeSessionId(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cleaned = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/^['"]+/, '')
    .replace(/['"\\]+$/, '')
    .trim();
  if (!CLAUDE_SESSION_ID_REGEX.test(cleaned)) return undefined;
  return cleaned;
}

function buildCommand({ prompt, promptExpression, threadId, model }: { prompt: string; promptExpression: string; threadId?: string; model?: string }): string {
  const promptValue = resolvePromptValue(prompt, promptExpression);
  const args = [
    '-p',
    promptValue,
    '--output-format',
    CLAUDE_OUTPUT_FORMAT,
    '--dangerously-skip-permissions',
  ];
  if (model) {
    args.push('--model', shellQuote(model));
  }
  const safeThreadId = sanitizeSessionId(threadId);
  if (safeThreadId) {
    args.push('--resume', shellQuote(safeThreadId));
  }
  return `${CLAUDE_CMD} ${args.join(' ')}`.trim();
}

interface ClaudeOutput {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  result?: string;
  text?: string;
  output?: string;
  structured_output?: unknown;
}

function parseOutput(output: string): AgentOutput {
  const cleaned = stripAnsi(output);
  const trimmed = cleaned.trim();
  if (!trimmed) return { text: '', threadId: undefined, sawJson: false };
  let payload: ClaudeOutput | null = safeJsonParse(trimmed);
  if (!payload) {
    const lines = trimmed.split(/\r?\n/).reverse();
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      payload = safeJsonParse(line.trim()) as ClaudeOutput | null;
      if (payload) break;
    }
  }
  if (!payload || typeof payload !== 'object') {
    return { text: trimmed, threadId: undefined, sawJson: false };
  }
  const threadId = sanitizeSessionId(
    payload.session_id ||
      payload.sessionId ||
      payload.conversation_id ||
      payload.conversationId ||
      undefined
  );
  let text: string = payload.result as string;
  if (typeof text !== 'string') {
    text = payload.text as string;
  }
  if (typeof text !== 'string') {
    text = payload.output as string;
  }
  if (typeof text !== 'string' && payload.structured_output != null) {
    text = JSON.stringify(payload.structured_output, null, 2);
  }
  return { text: typeof text === 'string' ? text.trim() : '', threadId, sawJson: true };
}

function parseStreamingOutput(output: string): { text: string; threadId: string | undefined; sawJson: boolean; sawFinal: boolean; commentaryMessages: string[] } {
  const parsed = parseOutput(output);
  const text = parsed.sawJson ? String(parsed.text || '').trim() : '';
  return {
    text,
    threadId: parsed.threadId,
    sawJson: parsed.sawJson,
    sawFinal: parsed.sawJson && Boolean(text),
    commentaryMessages: [],
  };
}

const claudeAgent: Agent = {
  id: 'claude',
  label: 'claude',
  needsPty: true,
  mergeStderr: false,
  command: CLAUDE_CMD,
  buildCommand,
  parseOutput,
  parseStreamingOutput,
  defaultModel: DEFAULT_MODEL,
};

export default claudeAgent;
