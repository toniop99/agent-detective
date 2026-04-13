import { shellQuote, wrapCommandWithPty } from './process.js';
import type { RunAgentOptions, Agent, ChildProcess } from './types.js';

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

interface CreateAgentRunnerOptions {
  agentTimeoutMs?: number;
  agentMaxBuffer?: number;
  execLocal: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  execLocalStreaming: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  terminateChildProcess: (child: ChildProcess | null, signal?: string) => void;
  getAgent: (id: string) => Agent | undefined;
  defaultModels?: {
    [agentId: string]: {
      defaultModel?: string;
    };
  };
  buildPrompt?: (prompt: string) => string;
  onFinalResponse?: (text: string) => void;
  onProgressUpdate?: (payload: unknown) => void;
  threadTurns?: Map<string, unknown>;
  postFinalGraceMs?: number;
  defaultTimeZone?: string;
}

interface ActiveRun {
  child: ChildProcess | null;
  finalEmitted: boolean;
  settled: boolean;
  stopPending: boolean;
}

function createAgentRunner(options: CreateAgentRunnerOptions) {
  const {
    agentTimeoutMs = DEFAULT_TIMEOUT_MS,
    agentMaxBuffer = DEFAULT_MAX_BUFFER,
    execLocal,
    execLocalStreaming,
    terminateChildProcess,
    getAgent,
    defaultModels,
    postFinalGraceMs = 30000,
  } = options;

  const activeRuns = new Map<string, ActiveRun>();

  function buildActiveRunKey(taskId: string, contextKey?: string): string {
    return `${taskId}:${contextKey || 'default'}`;
  }

  async function runAgentForChat(taskId: string, prompt: string, runOptions: RunAgentOptions = {}): Promise<string> {
    const {
      contextKey,
      repoPath,
      cwd = process.cwd(),
      agentId: overrideAgentId,
      model: modelOverride,
      onFinal,
      onProgress,
    } = runOptions;

    const effectiveAgentId = overrideAgentId || 'opencode';
    const agent = getAgent(effectiveAgentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${effectiveAgentId}`);
    }
    const activeKey = buildActiveRunKey(taskId, contextKey);

    console.info(
      `Agent start task=${taskId} agent=${effectiveAgentId} repo=${repoPath || 'none'}`
    );

    const startedAt = Date.now();

    const run: ActiveRun = {
      child: null,
      finalEmitted: false,
      settled: false,
      stopPending: false,
    };

    activeRuns.set(activeKey, run);

    const schedulePostFinalKill = (): void => {
      if (!run.child || run.finalEmitted) return;

      const delayMs = Math.max(0, Number(postFinalGraceMs) || 0);
      setTimeout(() => {
        if (run.settled || !run.child) return;
        terminateChildProcess?.(run.child, 'SIGTERM');
        setTimeout(() => {
          if (run.settled || !run.child) return;
          terminateChildProcess?.(run.child, 'SIGKILL');
        }, 1000);
      }, delayMs);
    };

    const emitFinal = (text: string): void => {
      const normalizedText = String(text || '').trim();
      if (!normalizedText || run.finalEmitted) return;
      run.finalEmitted = true;
      onFinal?.(normalizedText);
      schedulePostFinalKill();
    };

    const emitProgress = (payload: string[]): void => {
      onProgress?.(payload);
    };

    try {
      let result: string;

      if (agent.backend === 'app-server') {
        result = await runAppServerAgent(agent, {
          prompt,
          cwd,
          run,
          emitFinal,
          emitProgress,
        });
      } else {
        result = await runShellAgent(agent, {
          prompt,
          cwd,
          model: modelOverride,
          defaultModels,
          run,
          emitFinal,
          emitProgress,
          schedulePostFinalKill,
        });
      }

      run.settled = true;
      const elapsedMs = Date.now() - startedAt;
      console.info(
        `Agent finished task=${taskId} durationMs=${elapsedMs}`
      );

      return result;
    } catch (err) {
      run.settled = true;
      const elapsedMs = Date.now() - startedAt;
      console.error(
        `Agent error task=${taskId} durationMs=${elapsedMs} error=${(err as Error).message}`
      );
      throw err;
    } finally {
      activeRuns.delete(activeKey);
    }
  }

  async function runShellAgent(
    agent: Agent,
    {
      prompt,
      cwd,
      model,
      defaultModels,
      run,
      emitFinal,
      emitProgress,
      schedulePostFinalKill,
    }: {
      prompt: string;
      cwd: string;
      model?: string;
      defaultModels?: {
        [agentId: string]: {
          defaultModel?: string;
        };
      };
      run: ActiveRun;
      emitFinal: (text: string) => void;
      emitProgress: (payload: string[]) => void;
      schedulePostFinalKill: () => void;
    }
  ): Promise<string> {
    const promptBase64 = Buffer.from(prompt, 'utf8').toString('base64');
    const promptExpression = '"$PROMPT"';
    const effectiveModel = model || defaultModels?.[agent.id]?.defaultModel || agent.defaultModel;

    const agentCmd = agent.buildCommand?.({
      prompt,
      promptExpression,
      model: effectiveModel,
      thinking: undefined,
    }) || `${agent.command} ${promptExpression}`;

    const command = [
      `PROMPT_B64=${shellQuote(promptBase64)};`,
      'PROMPT=$(printf %s "$PROMPT_B64" | base64 --decode);',
      agentCmd,
    ].join(' ');

    let commandToRun = command;
    if (agent.needsPty) {
      commandToRun = wrapCommandWithPty(commandToRun);
    }
    if (agent.mergeStderr) {
      commandToRun = `${commandToRun} 2>&1`;
    }

    const canStream = typeof emitProgress === 'function' || typeof agent.parseStreamingOutput === 'function';

    if (canStream) {
      let streamedOutput = '';

      await execLocalStreaming('bash', ['-lc', commandToRun], {
        timeout: agentTimeoutMs,
        maxBuffer: agentMaxBuffer,
        cwd,
        onSpawn: (child: ChildProcess) => {
          run.child = child;
          schedulePostFinalKill();
        },
        onStdout: (chunk: string) => {
          streamedOutput += chunk;
          if (agent.parseStreamingOutput) {
            const partial = agent.parseStreamingOutput(streamedOutput);
            if (partial.commentaryMessages?.length) {
              emitProgress(partial.commentaryMessages);
            }
            if (partial.sawFinal && partial.text) {
              emitFinal(partial.text);
            }
          }
        },
      });

      if (!run.finalEmitted) {
        const parsed = agent.parseOutput?.(streamedOutput) || { text: streamedOutput, sawJson: false };
        return parsed.text || streamedOutput;
      }
      return '';
    } else {
      const output = await execLocal('bash', ['-lc', commandToRun], {
        timeout: agentTimeoutMs,
        maxBuffer: agentMaxBuffer,
        cwd,
      });

      const parsed = agent.parseOutput?.(output) || { text: output, sawJson: false };
      if (parsed.text) {
        emitFinal(parsed.text);
      }
      return parsed.text || output;
    }
  }

  async function runAppServerAgent(
    _agent: Agent,
    _options: {
      prompt: string;
      cwd: string;
      run: ActiveRun;
      emitFinal: (text: string) => void;
      emitProgress: (payload: string[]) => void;
    }
  ): Promise<string> {
    throw new Error('App-server agents not yet implemented');
  }

  return {
    runAgentForChat,
    stopActiveRun: async (taskId: string, contextKey?: string): Promise<{ status: 'idle' | 'stopping' }> => {
      const run = activeRuns.get(buildActiveRunKey(taskId, contextKey));
      if (!run || run.settled) return { status: 'idle' };
      if (run.stopPending) return { status: 'stopping' };

      run.stopPending = true;
      terminateChildProcess?.(run.child, 'SIGTERM');
      return { status: 'stopping' };
    },
  };
}

export { createAgentRunner };
export type { CreateAgentRunnerOptions };
