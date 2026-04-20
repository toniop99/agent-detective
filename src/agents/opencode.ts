import { shellQuote, resolvePromptValue, isCommandAvailable } from './utils.js';
import type { Agent, AgentOutput } from '../core/types.js';

const OPENCODE_CMD = 'opencode';
const OPENCODE_OUTPUT_FORMAT = 'json';
const DEFAULT_MODEL = 'opencode/gpt-5-nano';

/**
 * opencode's permission system (see https://opencode.ai/docs) consumes a JSON
 * object via the `OPENCODE_PERMISSION` env var. Keys are tool names (or `*`
 * wildcard) and values are `"allow" | "ask" | "deny"`.
 *
 * Full-access default keeps behavior compatible with existing callers.
 */
const OPENCODE_PERMISSION_FULL = '{"*": "allow"}';

/**
 * Read-only set: allow everything by default but explicitly DENY every tool
 * that can mutate the filesystem or execute shell commands. Used for
 * investigation-only workflows (Jira analysis, etc.) where the agent must
 * never modify the target repository.
 *
 * We use a deny-list rather than a default-deny + allow-list so opencode's
 * read-side tools (including any added in future versions) remain usable
 * without the adapter needing to be updated. If opencode introduces a new
 * mutating tool, add it here.
 */
const OPENCODE_PERMISSION_READ_ONLY =
  '{"*":"allow","bash":"deny","edit":"deny","write":"deny","multiedit":"deny","patch":"deny"}';

function pickPermission(readOnly: boolean | undefined): string {
  return readOnly ? OPENCODE_PERMISSION_READ_ONLY : OPENCODE_PERMISSION_FULL;
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildCommand({
  prompt,
  promptExpression,
  threadId,
  model,
  readOnly,
}: {
  prompt: string;
  promptExpression: string;
  threadId?: string;
  model?: string;
  readOnly?: boolean;
}): string {
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

  const permission = pickPermission(readOnly);
  return `OPENCODE_PERMISSION=${shellQuote(permission)} ${command} < /dev/null`;
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
  return `OPENCODE_PERMISSION=${shellQuote(OPENCODE_PERMISSION_FULL)} ${OPENCODE_CMD} models < /dev/null`;
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
