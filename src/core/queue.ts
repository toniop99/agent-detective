import type { Logger } from '@agent-detective/types';
import type { EnqueueFn, TaskQueue } from './types.js';

/**
 * Wraps a {@link TaskQueue} so that across **all** `queueKey` values at most
 * `maxConcurrent` jobs run `fn` at the same time. Per-key serialization of the
 * inner queue is preserved.
 */
export function createLimitedConcurrencyTaskQueue(
  inner: TaskQueue,
  maxConcurrent: number,
  logger: Logger
): TaskQueue {
  if (maxConcurrent < 1) {
    throw new Error('maxConcurrent must be at least 1');
  }

  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1;
        resolve();
      });
    });
  }

  function release(): void {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }

  return {
    enqueue(queueKey: string, fn: () => Promise<void>): Promise<void> {
      return inner.enqueue(queueKey, async () => {
        await acquire();
        const waitersDepth = waiters.length;
        if (waitersDepth > 0 && waitersDepth % 10 === 0) {
          logger.info(`task_concurrency_queue depth=${waitersDepth} max=${maxConcurrent}`);
        }
        try {
          await fn();
        } finally {
          release();
        }
      });
    },
    shutdown: inner.shutdown,
  };
}

/**
 * Task queue that ensures tasks with the same key are executed serially.
 * Tasks for different keys run in parallel.
 *
 * The promise returned to the caller of `enqueue` **rejects** if `fn` rejects, after
 * logging. A separate internal tail promise always settles so the next enqueued
 * work for the same key still runs.
 */

export function createEnqueue(queues: Map<string, Promise<void>>, logger: Logger): EnqueueFn {
  return function enqueue(queueKey: string, fn: () => Promise<void>): Promise<void> {
    const enqueuedAt = Date.now();
    const prevTail = queues.get(queueKey) || Promise.resolve();

    const work = prevTail.then(() => {
      const queueWaitMs = Date.now() - enqueuedAt;
      logger.info(`queue_start key=${queueKey} queue_wait_ms=${queueWaitMs}`);
      return fn();
    });

    const nextTail = work.catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      logger.error(`queue_error key=${queueKey}: ${e.message}`);
    });

    queues.set(queueKey, nextTail);

    // Remove the slot when this job's `work` promise settles (same timing as `await enqueue()`).
    work.finally(() => {
      if (queues.get(queueKey) === nextTail) {
        queues.delete(queueKey);
      }
    });

    return work;
  };
}

/** In-memory {@link TaskQueue} (one chain per `queueKey`). */
export function createMemoryTaskQueue(logger: Logger): TaskQueue {
  const queues = new Map<string, Promise<void>>();
  return { enqueue: createEnqueue(queues, logger) };
}
