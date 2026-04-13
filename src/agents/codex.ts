import { shellQuote, resolvePromptValue } from './utils.js';
import type { Agent, AgentOutput } from '../core/types.js';

const CODEX_CMD = 'codex';
const BASE_ARGS = '--json --skip-git-repo-check --yolo';
const MODEL_ARG = '--model';
const REASONING_CONFIG_KEY = 'model_reasoning_effort';

function appendOptionalArg(args: string, flag: string | undefined, value: string | undefined): string {
  if (!flag || !value) return args;
  return `${args} ${flag} ${shellQuote(value)}`.trim();
}

function appendOptionalReasoning(args: string, value: string | undefined): string {
  if (!value) return args;
  const configValue = `${REASONING_CONFIG_KEY}="${value}"`;
  return `${args} --config ${shellQuote(configValue)}`.trim();
}

function buildCommand({ prompt, promptExpression, threadId, model, thinking }: { prompt: string; promptExpression: string; threadId?: string; model?: string; thinking?: string }): string {
  const promptValue = resolvePromptValue(prompt, promptExpression);
  let args = BASE_ARGS;
  args = appendOptionalArg(args, MODEL_ARG, model);
  args = appendOptionalReasoning(args, thinking);
  if (threadId) {
    return `${CODEX_CMD} exec resume ${shellQuote(threadId)} ${args} ${promptValue}`.trim();
  }
  return `${CODEX_CMD} exec ${args} ${promptValue}`.trim();
}

interface MessagePayload {
  text?: string;
  content?: Array<{ text?: string; output_text?: string; input_text?: string }>;
  type?: string;
  channel?: string;
  metadata?: { channel?: string };
  phase?: string;
  message?: string;
}

function extractTextFromMessagePayload(message: MessagePayload | unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as MessagePayload;
  if (typeof msg.text === 'string') return msg.text;

  const content = Array.isArray(msg.content) ? msg.content : [];
  const textParts = content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.output_text === 'string') return part.output_text;
      if (typeof part.input_text === 'string') return part.input_text;
      return '';
    })
    .filter(Boolean);

  return textParts.join('\n').trim();
}

interface CollectMessagesResult {
  threadId: string | undefined;
  allMessages: string[];
  finalMessages: string[];
  commentaryMessages: string[];
  pendingMessages: string[];
  sawJson: boolean;
  sawTurnCompleted: boolean;
  sawExplicitFinal: boolean;
}

function pushMessageByPhase({
  text,
  phase,
  allMessages,
  finalMessages,
  commentaryMessages,
  pendingMessages,
}: {
  text: string;
  phase: string;
  allMessages: string[];
  finalMessages: string[];
  commentaryMessages: string[];
  pendingMessages: string[];
}): void {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return;

  allMessages.push(normalizedText);

  const normalizedPhase = String(phase || '').toLowerCase();
  if (normalizedPhase === 'final' || normalizedPhase === 'final_answer') {
    finalMessages.push(normalizedText);
  } else if (normalizedPhase === 'commentary') {
    commentaryMessages.push(normalizedText);
  } else if (pendingMessages) {
    pendingMessages.push(normalizedText);
  }
}

function collectMessages(output: string): CollectMessagesResult {
  const lines = String(output || '').split(/\r?\n/);
  let threadId: string | undefined;
  const allMessages: string[] = [];
  const finalMessages: string[] = [];
  const commentaryMessages: string[] = [];
  const pendingMessages: string[] = [];
  let sawJson = false;
  let sawTurnCompleted = false;
  let sawExplicitFinal = false;
  let buffer = '';

  for (const line of lines) {
    if (!buffer) {
      if (!line.startsWith('{')) {
        continue;
      }
      buffer = line;
    } else {
      buffer += line;
    }
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(buffer);
    } catch {
      continue;
    }
    sawJson = true;
    buffer = '';

    if (payload?.type === 'thread.started' && typeof payload.thread_id === 'string') {
      threadId = payload.thread_id;
      continue;
    }
    if (payload?.type === 'turn.completed') {
      sawTurnCompleted = true;
      continue;
    }
    if (payload?.type === 'item.completed' && payload.item && typeof (payload.item as MessagePayload).text === 'string') {
      const item = payload.item as MessagePayload;
      const itemType = String(item.type || '');
      if (itemType.includes('message')) {
        const channel = String(
          item.channel ||
            (item.message as MessagePayload)?.channel ||
            item.metadata?.channel ||
            ''
        ).toLowerCase();
        if (channel) {
          pushMessageByPhase({
            text: item.text || '',
            phase: channel,
            allMessages,
            finalMessages,
            commentaryMessages,
            pendingMessages,
          });
          if (channel === 'final') {
            sawExplicitFinal = true;
          }
        } else {
          pushMessageByPhase({
            text: item.text || '',
            phase: '',
            allMessages,
            finalMessages,
            commentaryMessages,
            pendingMessages,
          });
        }
      }
      continue;
    }

    if (payload?.type === 'response_item' && (payload.payload as MessagePayload)?.type === 'message') {
      const payloadMsg = payload.payload as MessagePayload;
      if (String(payloadMsg.phase || '').toLowerCase() === 'final_answer') {
        sawExplicitFinal = true;
      }
      pushMessageByPhase({
        text: extractTextFromMessagePayload(payloadMsg),
        phase: payloadMsg.phase || '',
        allMessages,
        finalMessages,
        commentaryMessages,
        pendingMessages,
      });
      continue;
    }

    if (payload?.type === 'event_msg' && (payload.payload as MessagePayload)?.type === 'agent_message') {
      const payloadMsg = payload.payload as MessagePayload;
      if (String(payloadMsg.phase || '').toLowerCase() === 'final_answer') {
        sawExplicitFinal = true;
      }
      pushMessageByPhase({
        text: payloadMsg.message || '',
        phase: payloadMsg.phase || '',
        allMessages,
        finalMessages,
        commentaryMessages,
        pendingMessages,
      });
    }
  }

  if (finalMessages.length === 0 && pendingMessages.length > 0 && sawTurnCompleted) {
    finalMessages.push(pendingMessages[pendingMessages.length - 1]);
  }

  return {
    threadId,
    allMessages,
    finalMessages,
    commentaryMessages,
    pendingMessages,
    sawJson,
    sawTurnCompleted,
    sawExplicitFinal,
  };
}

function parseOutput(output: string): AgentOutput {
  const { threadId, allMessages, finalMessages, sawJson } = collectMessages(output);
  const selected = finalMessages.length > 0 ? finalMessages : allMessages.slice(-1);
  const text = selected.join('\n').trim();
  return { text, threadId, sawJson };
}

function parseStreamingOutput(output: string): { text: string; threadId: string | undefined; sawJson: boolean; sawFinal: boolean; commentaryMessages: string[] } {
  const {
    threadId,
    finalMessages,
    commentaryMessages,
    sawJson,
    sawTurnCompleted,
    sawExplicitFinal,
  } = collectMessages(output);
  const text = finalMessages.length > 0
    ? String(finalMessages[finalMessages.length - 1] || '').trim()
    : '';
  return {
    text,
    threadId,
    sawJson,
    sawFinal: sawExplicitFinal || (finalMessages.length > 0 && sawTurnCompleted),
    commentaryMessages,
  };
}

const codexAgent: Agent = {
  id: 'codex',
  label: 'codex',
  needsPty: false,
  mergeStderr: false,
  command: CODEX_CMD,
  buildCommand,
  parseOutput,
  parseStreamingOutput,
};

export default codexAgent;
