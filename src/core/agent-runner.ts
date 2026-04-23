import { shellQuote, wrapCommandWithPty } from './process.js';
import type { RunAgentOptions, Agent, AgentOutput, ChildProcess, AgentInfo, Logger } from './types.js';

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

interface CreateAgentRunnerOptions {
  agentTimeoutMs?: number;
  agentMaxBuffer?: number;
  /** After SIGTERM, delay before SIGKILL (default 1000). */
  forceKillDelayMs?: number;
  execLocal: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  execLocalStreaming: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  terminateChildProcess: (child: ChildProcess | null, signal?: string) => void;
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
  /** Defaults to `console` when omitted (e.g. unit tests). */
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Agent to use when no `agentId` is passed to `runAgentForChat`. Defaults to `'opencode'`. */
  defaultAgentId?: string;
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
    defaultModels,
    postFinalGraceMs = 30000,
    forceKillDelayMs = 1000,
    logger: log = console,
    defaultAgentId,
  } = options;

  const agents = new Map<string, Agent>();
  const activeRuns = new Map<string, ActiveRun>();

  // Per-agent serialization chain. Only populated for agents with
  // `singleInstance: true` (e.g. opencode — see the flag's docstring in
  // `@agent-detective/types`). The value is always a resolved-or-pending
  // promise representing "the tail of the queue for this agent"; a new
  // caller awaits it, then installs its own tail, then runs.
  const agentSerializationTails = new Map<string, Promise<void>>();

  function buildActiveRunKey(taskId: string, contextKey?: string): string {
    return `${taskId}:${contextKey || 'default'}`;
  }

  /**
   * Acquire an exclusive slot on a single-instance agent. Returns a release
   * function that the caller MUST invoke in a `finally` to let the next
   * waiter proceed. Callers for non-single-instance agents should not call
   * this; it would still work but adds a redundant microtask.
   */
  async function acquireAgentSlot(
    agentId: string,
    taskId: string
  ): Promise<() => void> {
    const prev = agentSerializationTails.get(agentId) ?? Promise.resolve();
    let release!: () => void;
    const ours = new Promise<void>((resolve) => {
      release = resolve;
    });
    agentSerializationTails.set(agentId, ours);

    const waitStartedAt = Date.now();
    await prev;
    const waitMs = Date.now() - waitStartedAt;
    if (waitMs > 10) {
      log.info(
        `Agent queued task=${taskId} agent=${agentId} singleInstance=true waitMs=${waitMs}`,
      );
    }

    return () => {
      release();
      // If no one else queued after us, drop the entry so the map doesn't
      // grow unbounded across a long-running process.
      if (agentSerializationTails.get(agentId) === ours) {
        agentSerializationTails.delete(agentId);
      }
    };
  }

  async function runAgentForChat(taskId: string, prompt: string, runOptions: RunAgentOptions = {}): Promise<AgentOutput> {
    const {
      contextKey,
      repoPath,
      cwd = process.cwd(),
      agentId: overrideAgentId,
      model: modelOverride,
      onFinal,
      onProgress,
      onStdout: callerOnStdout,
      readOnly,
      timeoutMs: runTimeoutMs,
      threadId,
      inputFiles,
    } = runOptions;

    const effectiveAgentId = overrideAgentId || defaultAgentId || 'opencode';
    const agent = agents.get(effectiveAgentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${effectiveAgentId}. Ensure it is registered.`);
    }
    const activeKey = buildActiveRunKey(taskId, contextKey);

    // Wait for our turn on single-instance agents BEFORE emitting the "start"
    // log or computing durations, so the log reflects the actual spawn time
    // (not queue-wait time). `acquireAgentSlot` logs its own queued/waitMs
    // line when the wait is non-trivial.
    const releaseAgentSlot = agent.singleInstance
      ? await acquireAgentSlot(agent.id, taskId)
      : null;

    log.info(
      `Agent start task=${taskId} agent=${effectiveAgentId} repo=${repoPath || 'none'}${readOnly ? ' readOnly=true' : ''}`,
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
        }, Math.max(0, Number(forceKillDelayMs) || 0));
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
      const result: AgentOutput = await runShellAgent(agent, {
        prompt,
        cwd,
        model: modelOverride,
        defaultModels,
        run,
        emitFinal,
        emitProgress,
        callerOnStdout,
        readOnly,
        timeoutMs: runTimeoutMs,
        threadId: threadId && String(threadId).trim() ? String(threadId).trim() : undefined,
        inputFiles,
      });

      run.settled = true;
      const elapsedMs = Date.now() - startedAt;
      result.usage = { ...result.usage, wallTimeMs: elapsedMs };
      log.info(`Agent finished task=${taskId} durationMs=${elapsedMs}${result.threadId ? ` threadId=${result.threadId}` : ''}`);

      return result;
    } catch (err) {
      run.settled = true;
      const elapsedMs = Date.now() - startedAt;
      log.error(
        `Agent error task=${taskId} durationMs=${elapsedMs} error=${(err as Error).message}`,
      );
      throw err;
    } finally {
      activeRuns.delete(activeKey);
      releaseAgentSlot?.();
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
      callerOnStdout,
      readOnly,
      timeoutMs: shellTimeoutMs,
      threadId,
      inputFiles,
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
      callerOnStdout?: (chunk: string) => void;
      readOnly?: boolean;
      timeoutMs?: number;
      threadId?: string;
      inputFiles?: string[];
    }
  ): Promise<AgentOutput> {
    const effectiveTimeoutMs =
      typeof shellTimeoutMs === 'number' && shellTimeoutMs > 0 ? shellTimeoutMs : agentTimeoutMs;
    const promptBase64 = Buffer.from(prompt, 'utf8').toString('base64');
    const promptExpression = '"$PROMPT"';
    const effectiveModel = model || defaultModels?.[agent.id]?.defaultModel || agent.defaultModel;

    const agentCmd = agent.buildCommand?.({
      prompt,
      promptExpression,
      model: effectiveModel,
      thinking: undefined,
      readOnly,
      threadId,
      inputFiles,
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
        timeout: effectiveTimeoutMs,
        maxBuffer: agentMaxBuffer,
        cwd,
        onSpawn: (child: ChildProcess) => {
          run.child = child;
        },
        onStdout: (chunk: string) => {
          streamedOutput += chunk;
          callerOnStdout?.(chunk);
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

      const parsed = agent.parseOutput?.(streamedOutput) || { text: streamedOutput, sawJson: false };
      return { text: parsed.text || streamedOutput, sawJson: parsed.sawJson, threadId: parsed.threadId, usage: parsed.usage };
    } else {
      const output = await execLocal('bash', ['-lc', commandToRun], {
        timeout: effectiveTimeoutMs,
        maxBuffer: agentMaxBuffer,
        cwd,
      });

      const parsed = agent.parseOutput?.(output) || { text: output, sawJson: false };
      if (parsed.text) {
        emitFinal(parsed.text);
      }
      return { text: parsed.text || output, sawJson: parsed.sawJson, threadId: parsed.threadId, usage: parsed.usage };
    }
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
    registerAgent: (agent: Agent): void => {
      if (agents.has(agent.id)) {
        log.warn(`Agent ${agent.id} already registered, overwriting`);
      }
      agents.set(agent.id, agent);
    },
    listAgents: async (): Promise<AgentInfo[]> => {
      const results: AgentInfo[] = [];
      for (const agent of agents.values()) {
        const available = agent.checkAvailable ? await agent.checkAvailable() : true;
        results.push({
          id: agent.id,
          label: agent.label,
          defaultModel: agent.defaultModel,
          available,
          needsPty: agent.needsPty,
          mergeStderr: agent.mergeStderr,
        });
      }
      return results;
    },
    shutdown: (): void => {
      for (const [key, run] of activeRuns) {
        if (!run.settled && run.child) {
          log.info(`Shutting down active agent run: ${key}`);
          terminateChildProcess?.(run.child, 'SIGTERM');
        }
      }
    },
  };
}

export { createAgentRunner };
export type { CreateAgentRunnerOptions };
