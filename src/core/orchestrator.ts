import { StandardEvents } from '@agent-detective/sdk';
import type {
  EventBus,
  AgentRunner,
  EnqueueFn,
  TaskEvent,
  Logger,
} from '@agent-detective/types';
import { RUN_RECORD_SCHEMA, buildRunRecordBase, type RunRecordWriter } from './run-records.js';

export interface OrchestratorDeps {
  eventBus: EventBus;
  agentRunner: AgentRunner;
  enqueue: EnqueueFn;
  logger: Pick<Logger, 'error' | 'warn'>;
  /** When set, caps a single `runAgentForChat` invocation for orchestrated tasks. */
  maxWallTimeMs?: number;
  /** Optional JSONL sink for task lifecycle (start / completed / failed). */
  runRecords?: RunRecordWriter;
}

export function createOrchestrator(deps: OrchestratorDeps) {
  const { eventBus, agentRunner, enqueue, logger, maxWallTimeMs, runRecords } = deps;

  function start() {
    eventBus.on(StandardEvents.TASK_CREATED, handleTaskCreated);
  }

  async function handleTaskCreated(task: TaskEvent) {
    const queueKey = task.id;

    await enqueue(queueKey, async () => {
      const startedAt = Date.now();
      const base = buildRunRecordBase(task);
      if (runRecords) {
        await runRecords.append({
          schema: RUN_RECORD_SCHEMA,
          phase: 'started',
          ts: new Date().toISOString(),
          ...base,
        });
      }
      try {
        // 1. Gather context from plugins (like repository analysis)
        const contextPieces = await eventBus.invokeAsync<string>(
          StandardEvents.TASK_GATHER_CONTEXT,
          task
        );

        // 2. Assemble prompt
        let finalPrompt = task.message;
        if (contextPieces.length > 0) {
          finalPrompt += '\n\nAdditional Context:\n' + contextPieces.join('\n\n');
        }

        // 3. Run Agent
        const runPromise = agentRunner.runAgentForChat(task.id, finalPrompt, {
          repoPath: task.context.repoPath,
          model: task.context.model,
          cwd: task.context.cwd,
          readOnly: task.metadata?.readOnly === true,
          threadId: task.context.threadId ?? undefined,
        });
        const result =
          maxWallTimeMs !== undefined && maxWallTimeMs > 0
            ? await raceWithWallTimeout(runPromise, maxWallTimeMs)
            : await runPromise;

        // 4. Emit completion
        eventBus.emit(StandardEvents.TASK_COMPLETED, {
          event: task,
          result: result.text,
        });
        if (runRecords) {
          await runRecords.append({
            schema: RUN_RECORD_SCHEMA,
            phase: 'completed',
            ts: new Date().toISOString(),
            ...base,
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Orchestrator error for task ${task.id}: ${message}`);
        eventBus.emit(StandardEvents.TASK_FAILED, {
          event: task,
          error: message,
        });
        if (runRecords) {
          await runRecords.append({
            schema: RUN_RECORD_SCHEMA,
            phase: 'failed',
            ts: new Date().toISOString(),
            ...base,
            durationMs: Date.now() - startedAt,
            error: message,
          });
        }
      }
    });
  }

  return {
    start,
  };
}

async function raceWithWallTimeout<T>(work: Promise<T>, maxWallTimeMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Task exceeded orchestrator wall time (${maxWallTimeMs}ms)`));
    }, maxWallTimeMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
