import type { EventBus, EventBusHandler, Logger } from '@agent-detective/types';

export class AsyncEventBus implements EventBus {
  private handlers = new Map<string, EventBusHandler[]>();

  constructor(private readonly log: Pick<Logger, 'error'> = console) {}

  /**
   * Register a listener for an event.
   */
  on(event: string, handler: EventBusHandler): void {
    const list = this.handlers.get(event) || [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  /**
   * Unregister a listener for an event.
   */
  off(event: string, handler: EventBusHandler): void {
    const list = this.handlers.get(event) || [];
    const index = list.indexOf(handler);
    if (index !== -1) {
      list.splice(index, 1);
      if (list.length === 0) {
        this.handlers.delete(event);
      } else {
        this.handlers.set(event, list);
      }
    }
  }

  /**
   * Emit an event without waiting for responses (fire-and-forget).
   */
  emit(event: string, ...args: unknown[]): void {
    const list = this.handlers.get(event) || [];
    for (const handler of list) {
      try {
        void handler(...args);
      } catch (err) {
        this.log.error(`Error in event handler for ${event}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Invoke all handlers asynchronously and gather their return values.
   * Useful for hook-like behavior where handlers provide data.
   */
  async invokeAsync<T>(event: string, ...args: unknown[]): Promise<T[]> {
    const list = this.handlers.get(event) || [];
    const promises = list.map(async (handler) => {
      try {
        return await handler(...args);
      } catch (err) {
        this.log.error(
          `Error in async event handler for ${event}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    });
    const results = await Promise.all(promises);
    return results.filter((r) => r !== null && r !== undefined) as T[];
  }
}

export function createEventBus(log?: Pick<Logger, 'error'>): EventBus {
  return new AsyncEventBus(log);
}
