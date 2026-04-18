export class AsyncEventBus {
  private handlers = new Map<string, Array<(...args: any[]) => any>>();

  /**
   * Register a listener for an event.
   */
  on(event: string, handler: (...args: any[]) => any): void {
    const list = this.handlers.get(event) || [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  /**
   * Unregister a listener for an event.
   */
  off(event: string, handler: (...args: any[]) => any): void {
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
  emit(event: string, ...args: any[]): void {
    const list = this.handlers.get(event) || [];
    for (const handler of list) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`Error in event handler for ${event}:`, err);
      }
    }
  }

  /**
   * Invoke all handlers asynchronously and gather their return values.
   * Useful for hook-like behavior where handlers provide data.
   */
  async invokeAsync<T>(event: string, ...args: any[]): Promise<T[]> {
    const list = this.handlers.get(event) || [];
    const promises = list.map(async (handler) => {
      try {
        return await handler(...args);
      } catch (err) {
        console.error(`Error in async event handler for ${event}:`, err);
        return null;
      }
    });
    const results = await Promise.all(promises);
    return results.filter((r) => r !== null && r !== undefined) as T[];
  }
}

export function createEventBus(): AsyncEventBus {
  return new AsyncEventBus();
}
