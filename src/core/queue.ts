import type { EnqueueFn, TaskQueue } from './types.js';

/**
 * Task queue that ensures tasks with the same key are executed serially.
 * Tasks for different keys run in parallel.
 */

export function createEnqueue(queues: Map<string, Promise<void>>): EnqueueFn {
  return function enqueue(queueKey: string, fn: () => Promise<void>): Promise<void> {
    const enqueuedAt = Date.now();
    const prev = queues.get(queueKey) || Promise.resolve();

    const next = prev
      .then(async () => {
        const queueWaitMs = Date.now() - enqueuedAt;
        console.info(`queue_start key=${queueKey} queue_wait_ms=${queueWaitMs}`);
        return fn();
      })
      .catch((err: Error) => {
        console.error('Queue error', err);
      }) as Promise<void>;

    queues.set(queueKey, next);

    next.finally(() => {
      if (queues.get(queueKey) === next) {
        queues.delete(queueKey);
      }
    });

    return next;
  };
}

/** In-memory {@link TaskQueue} (one chain per `queueKey`). */
export function createMemoryTaskQueue(): TaskQueue {
  const queues = new Map<string, Promise<void>>();
  return { enqueue: createEnqueue(queues) };
}
