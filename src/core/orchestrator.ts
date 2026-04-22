import {
  StandardEvents,
  type EventBus,
  type AgentRunner,
  type EnqueueFn,
  type TaskEvent,
  type Logger,
} from '@agent-detective/types';

export interface OrchestratorDeps {
  eventBus: EventBus;
  agentRunner: AgentRunner;
  enqueue: EnqueueFn;
  logger: Pick<Logger, 'error'>;
}

export function createOrchestrator(deps: OrchestratorDeps) {
  const { eventBus, agentRunner, enqueue, logger } = deps;

  function start() {
    eventBus.on(StandardEvents.TASK_CREATED, handleTaskCreated);
  }

  async function handleTaskCreated(task: TaskEvent) {
    const queueKey = task.id;

    await enqueue(queueKey, async () => {
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
        const result = await agentRunner.runAgentForChat(task.id, finalPrompt, {
          repoPath: task.context.repoPath,
          model: task.context.model,
          cwd: task.context.cwd,
          readOnly: task.metadata?.readOnly === true,
          threadId: task.context.threadId ?? undefined,
        });

        // 4. Emit completion
        eventBus.emit(StandardEvents.TASK_COMPLETED, {
          event: task,
          result,
        });
      } catch (err) {
        logger.error(
          `Orchestrator error for task ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        eventBus.emit(StandardEvents.TASK_FAILED, {
          event: task,
          error: (err as Error).message,
        });
      }
    });
  }

  return {
    start,
  };
}
