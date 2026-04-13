import { resolvePromptValue } from './utils.js';
import type { Agent, AgentOutput } from '../core/types.js';

const GEMINI_CMD = 'gemini';
const GEMINI_OUTPUT_FORMAT = 'json';
const SESSION_ID_REGEX = /\[([0-9a-f-]{16,})\]/i;
const DEFAULT_MODEL = 'gemini-2.5-pro-preview-06-05';

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildCommand({ prompt, promptExpression, threadId, model }: { prompt: string; promptExpression: string; threadId?: string; model?: string }): string {
  const promptValue = resolvePromptValue(prompt, promptExpression);
  const args = ['-p', promptValue, '--output-format', GEMINI_OUTPUT_FORMAT, '--yolo'];
  if (model) {
    args.push('--model', model);
  }
  if (threadId) {
    args.push('--resume', threadId);
  }
  return `${GEMINI_CMD} ${args.join(' ')}`.trim();
}

interface GeminiOutput {
  error?: { message?: string };
  response?: string;
}

function parseOutput(output: string): AgentOutput {
  const trimmed = String(output || '').trim();
  if (!trimmed) return { text: '', threadId: undefined, sawJson: false };
  const payload = safeJsonParse(trimmed) as GeminiOutput | null;
  if (!payload || typeof payload !== 'object') {
    return { text: trimmed, threadId: undefined, sawJson: false };
  }
  if (payload.error?.message) {
    return { text: String(payload.error.message), threadId: undefined, sawJson: true };
  }
  const response = typeof payload.response === 'string' ? payload.response.trim() : '';
  return { text: response, threadId: undefined, sawJson: true };
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

function listSessionsCommand(): string {
  return `${GEMINI_CMD} --list-sessions`;
}

function parseSessionList(output: string): string | undefined {
  const lines = String(output || '').split(/\r?\n/);
  let lastId: string | undefined;
  for (const line of lines) {
    const match = line.match(SESSION_ID_REGEX);
    if (match) {
      lastId = match[1];
    }
  }
  return lastId;
}

const geminiAgent: Agent = {
  id: 'gemini',
  label: 'gemini',
  needsPty: false,
  mergeStderr: false,
  command: GEMINI_CMD,
  buildCommand,
  parseOutput,
  parseStreamingOutput,
  listSessionsCommand,
  parseSessionList,
  defaultModel: DEFAULT_MODEL,
};

export default geminiAgent;
