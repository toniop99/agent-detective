import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ObservabilityTracingConfig } from './config.js';

export interface CorrelationContext {
  correlationId: string;
  sampled: boolean;
  parentSpanId?: string;
}

export interface TracingContext {
  getCorrelationId(): string | undefined;
  getContext(): CorrelationContext | undefined;
  withCorrelationId<T>(id: string, fn: () => T): T;
  withContext(ctx: CorrelationContext, fn: () => void): void;
  /**
   * Sets the correlation context for the rest of the current async chain.
   * Use from Fastify `onRequest` hooks (which can't wrap downstream code in
   * a callback) so subsequent hooks and the route handler see the id via
   * {@link TracingContext.getCorrelationId}.
   */
  enterCorrelationContext(id: string): void;
  shouldSample(path?: string): boolean;
  generateCorrelationId(): string;
}

export function createTracing(config: ObservabilityTracingConfig): TracingContext {
  const storage = new AsyncLocalStorage<CorrelationContext>();

  function isAlwaysSampledPath(path: string | undefined): boolean {
    if (!path) return false;
    return config.alwaysSampleForPaths.some(
      (p) => path === p || path.startsWith(p)
    );
  }

  function shouldSample(path?: string): boolean {
    if (!config.enabled) return false;
    if (isAlwaysSampledPath(path)) return true;
    return Math.random() < config.sampleRate;
  }

  function generateCorrelationId(): string {
    return randomUUID();
  }

  function getCorrelationId(): string | undefined {
    return storage.getStore()?.correlationId;
  }

  function getContext(): CorrelationContext | undefined {
    return storage.getStore();
  }

  function withCorrelationId<T>(id: string, fn: () => T): T {
    const ctx: CorrelationContext = {
      correlationId: id,
      sampled: true,
    };
    return storage.run(ctx, fn);
  }

  function withContext(ctx: CorrelationContext, fn: () => void): void {
    storage.run(ctx, fn);
  }

  function enterCorrelationContext(id: string): void {
    const ctx: CorrelationContext = { correlationId: id, sampled: true };
    storage.enterWith(ctx);
  }

  return {
    getCorrelationId,
    getContext,
    withCorrelationId,
    withContext,
    enterCorrelationContext,
    shouldSample,
    generateCorrelationId,
  };
}
