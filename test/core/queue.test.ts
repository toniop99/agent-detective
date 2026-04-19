import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createEnqueue, createMemoryTaskQueue } from '../../src/core/queue.js';

describe('Queue', () => {
  let queues: Map<string, Promise<void>>;

  beforeEach(() => {
    queues = new Map<string, Promise<void>>();
  });

  it('executes task immediately if queue is empty', async () => {
    const enqueue = createEnqueue(queues);
    let executed = false;

    await enqueue('task-1', async () => {
      executed = true;
    });

    assert.ok(executed);
    assert.equal(queues.size, 0);
  });

  it('queues tasks with same key sequentially', async () => {
    const enqueue = createEnqueue(queues);
    const order: string[] = [];

    await enqueue('task-1', async () => {
      order.push('a-start');
      await delay(50);
      order.push('a-end');
    });

    await enqueue('task-1', async () => {
      order.push('b');
    });

    await delay(150);

    assert.deepEqual(order, ['a-start', 'a-end', 'b']);
  });

  it('executes tasks with different keys in parallel', async () => {
    const enqueue = createEnqueue(queues);
    const order: string[] = [];

    await enqueue('task-1', async () => {
      order.push('1-start');
      await delay(50);
      order.push('1-end');
    });

    await enqueue('task-2', async () => {
      order.push('2-start');
      await delay(20);
      order.push('2-end');
    });

    await delay(100);

    assert.ok(order.indexOf('1-start') < order.indexOf('1-end'));
    assert.ok(order.indexOf('2-start') < order.indexOf('2-end'));
  });

  it('cleans up queue after task completes', async () => {
    const enqueue = createEnqueue(queues);

    await enqueue('task-1', async () => {});

    assert.equal(queues.size, 0);
  });

  it('createMemoryTaskQueue matches createEnqueue behavior', async () => {
    const { enqueue } = createMemoryTaskQueue();
    let executed = false;
    await enqueue('k', async () => {
      executed = true;
    });
    assert.ok(executed);
  });

  it('handles errors without crashing', async () => {
    const enqueue = createEnqueue(queues);
    let errorHandled = false;

    await enqueue('task-1', async () => {
      throw new Error('Test error');
    });

    await enqueue('task-1', async () => {
      errorHandled = true;
    });

    assert.ok(errorHandled);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
