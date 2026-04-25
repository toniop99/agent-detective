import { shellQuote, resolvePromptValue, isCommandAvailable } from './utils.js';
import type { Agent, AgentOutput, AgentUsage, BuildCommandOptions, StreamingOutput } from '../core/types.js';

const CLAUDE_CMD = 'claude';
const CLAUDE_OUTPUT_FORMAT = 'stream-json';
const CLAUDE_SESSION_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MODEL = 'sonnet';

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const DEL = String.fromCharCode(0x7f);
const C0_AND_DEL = [...Array(32).keys()].map((i) => String.fromCharCode(i)).join('') + DEL;
const ANSI_CSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const ANSI_OSC_PATTERN = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'g');
const CTRL_OR_DEL_PATTERN = new RegExp(`[${C0_AND_DEL}]`, 'g');

function stripAnsi(value: string): string {
  return String(value || '').replace(ANSI_CSI_PATTERN, '').replace(ANSI_OSC_PATTERN, '');
}

function sanitizeSessionId(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cleaned = String(value)
    .replace(CTRL_OR_DEL_PATTERN, '')
    .trim()
    .replace(/^['"]+/, '')
    .replace(/['"\\]+$/, '')
    .trim();
  if (!CLAUDE_SESSION_ID_REGEX.test(cleaned)) return undefined;
  return cleaned;
}

function buildCommand({ prompt, promptExpression, threadId, model, readOnly }: BuildCommandOptions): string {
  const promptValue = resolvePromptValue(prompt, promptExpression);
  const args = [
    '-p',
    promptValue,
    '--output-format',
    CLAUDE_OUTPUT_FORMAT,
    '--verbose',
    ...(readOnly
      ? ['--allowedTools', 'Read,LS,Glob,Grep,WebSearch,WebFetch']
      : ['--dangerously-skip-permissions']),
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

interface StreamEvent {
  type?: string;
  session_id?: string;
  // result message fields
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  // stream_event fields
  event?: {
    type?: string;
    message?: { id?: string };
    delta?: { type?: string; text?: string };
    content_block?: { type?: string; name?: string };
  };
}

function extractUsage(evt: StreamEvent): AgentUsage | undefined {
  if (evt.type !== 'result') return undefined;
  const u: AgentUsage = {};
  if (typeof evt.duration_ms === 'number') u.durationMs = evt.duration_ms;
  if (typeof evt.duration_api_ms === 'number') u.durationApiMs = evt.duration_api_ms;
  if (typeof evt.num_turns === 'number') u.numTurns = evt.num_turns;
  if (typeof evt.total_cost_usd === 'number') u.totalCostUsd = evt.total_cost_usd;
  if (typeof evt.usage?.input_tokens === 'number') u.inputTokens = evt.usage.input_tokens;
  if (typeof evt.usage?.output_tokens === 'number') u.outputTokens = evt.usage.output_tokens;
  return Object.keys(u).length > 0 ? u : undefined;
}

function parseOutput(output: string): AgentOutput {
  const cleaned = stripAnsi(output);
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());

  let sessionId: string | undefined;
  let resultText = '';
  let usage: AgentOutput['usage'];

  for (const line of lines) {
    const evt = safeJsonParse(line.trim()) as StreamEvent | null;
    if (!evt) continue;

    if (evt.session_id) {
      sessionId = sanitizeSessionId(evt.session_id) ?? sessionId;
    }

    if (evt.type === 'result') {
      resultText = typeof evt.result === 'string' ? evt.result : '';
      usage = extractUsage(evt);
    }
  }

  if (resultText) {
    return { text: resultText.trim(), threadId: sessionId, sawJson: true, usage };
  }

  // Fallback: accumulate text deltas from stream events
  let accumulated = '';
  for (const line of lines) {
    const evt = safeJsonParse(line.trim()) as StreamEvent | null;
    if (!evt || evt.type !== 'stream_event') continue;
    if (evt.event?.delta?.type === 'text_delta' && evt.event.delta.text) {
      accumulated += evt.event.delta.text;
    }
  }

  if (accumulated) {
    return { text: accumulated.trim(), threadId: sessionId, sawJson: true };
  }

  return { text: cleaned.trim(), threadId: sessionId, sawJson: false };
}

function parseStreamingOutput(output: string): StreamingOutput {
  const cleaned = stripAnsi(output);
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());

  let sessionId: string | undefined;
  let sawFinal = false;
  let resultText = '';
  let usage: AgentOutput['usage'];
  const commentary: string[] = [];

  for (const line of lines) {
    const evt = safeJsonParse(line.trim()) as StreamEvent | null;
    if (!evt) continue;

    if (evt.session_id) {
      sessionId = sanitizeSessionId(evt.session_id) ?? sessionId;
    }

    if (evt.type === 'result') {
      sawFinal = true;
      resultText = typeof evt.result === 'string' ? evt.result : '';
      usage = extractUsage(evt);
    }

    if (evt.type === 'stream_event' && evt.event) {
      // Tool use start — report which tool Claude is calling
      if (evt.event.type === 'content_block_start' && evt.event.content_block?.type === 'tool_use' && evt.event.content_block.name) {
        commentary.push(`Tool: ${evt.event.content_block.name}`);
      }
    }
  }

  return {
    text: resultText.trim(),
    threadId: sessionId,
    sawJson: sawFinal,
    sawFinal,
    commentaryMessages: commentary,
    usage,
  };
}

const claudeAgent: Agent = {
  id: 'claude',
  label: 'claude',
  needsPty: false,
  mergeStderr: false,
  command: CLAUDE_CMD,
  buildCommand,
  parseOutput,
  parseStreamingOutput,
  defaultModel: DEFAULT_MODEL,
  checkAvailable: () => isCommandAvailable(CLAUDE_CMD),
};

export default claudeAgent;
