import { shellQuote, resolvePromptValue, isCommandAvailable } from './utils.js';
import type { Agent, AgentOutput } from '../core/types.js';

const OPENCODE_CMD = 'opencode';
const OPENCODE_PERMISSION = '{"*": "allow"}';
const OPENCODE_OUTPUT_FORMAT = 'json';
const DEFAULT_MODEL = 'opencode/gpt-5-nano';

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildCommand({ prompt, promptExpression, threadId, model }: { prompt: string; promptExpression: string; threadId?: string; model?: string }): string {
  const promptValue = resolvePromptValue(prompt, promptExpression);
  const args = ['run', '--format', OPENCODE_OUTPUT_FORMAT];

  const modelToUse = model || DEFAULT_MODEL;
  args.push('--model', shellQuote(modelToUse));

  if (threadId) {
    args.push('--continue');
    args.push('--session', shellQuote(threadId));
  }

  args.push(promptValue);

  const command = `${OPENCODE_CMD} ${args.join(' ')}`.trim();

  return `OPENCODE_PERMISSION=${shellQuote(OPENCODE_PERMISSION)} ${command} < /dev/null`;
}

function parseOutput(output: string): AgentOutput {
  const lines = String(output || '').split(/\r?\n/);
  let threadId: string | undefined;
  const textParts: string[] = [];
  let sawJson = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!trimmed.startsWith('{')) continue;

    const payload = safeJsonParse(trimmed);
    if (!payload || typeof payload !== 'object') continue;

    sawJson = true;

    if (payload.sessionID) {
      threadId = payload.sessionID as string;
    }

    if (payload.type === 'text' && payload.part && (payload.part as { text?: string }).text) {
      textParts.push((payload.part as { text: string }).text);
    }
  }

  const text = textParts.join('').trim();

  if (!sawJson) {
    return {
      text: String(output || '').trim(),
      threadId: undefined,
      sawJson: false,
    };
  }

  return { text, threadId, sawJson: true };
}

function listModelsCommand(): string {
  return `OPENCODE_PERMISSION=${shellQuote(OPENCODE_PERMISSION)} ${OPENCODE_CMD} models < /dev/null`;
}

function parseModelList(output: string): string {
  const lines = String(output || '').split(/\r?\n/);
  const models: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('INFO')) continue;
    models.push(trimmed);
  }
  return models.join('\n');
}

const opencodeAgent: Agent = {
  id: 'opencode',
  label: 'opencode',
  needsPty: false,
  mergeStderr: false,
  command: OPENCODE_CMD,
  buildCommand,
  parseOutput,
  listModelsCommand,
  parseModelList,
  defaultModel: DEFAULT_MODEL,
  checkAvailable: () => isCommandAvailable(OPENCODE_CMD),
};

export default opencodeAgent;
