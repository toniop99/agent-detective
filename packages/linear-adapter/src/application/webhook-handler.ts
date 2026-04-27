import { routeLinearWebhook, type LinearHandlerContext } from './linear-handlers.js';

export type LinearWebhookHandleResult = {
  status: 'success' | 'ignored' | 'error';
  message?: string;
};

export function createLinearWebhookHandler(ctx: LinearHandlerContext) {
  const { logger } = ctx;
  return {
    async handleWebhook(body: Record<string, unknown>): Promise<LinearWebhookHandleResult> {
      const type = typeof body.type === 'string' ? body.type : 'unknown';
      const action = typeof body.action === 'string' ? body.action : 'unknown';
      logger?.info(`linear-adapter: webhook type=${type} action=${action}`);
      try {
        await routeLinearWebhook(body, ctx);
        return { status: 'success', message: 'processed' };
      } catch (err) {
        logger?.error(`linear-adapter: webhook handler error: ${(err as Error).message}`);
        return { status: 'error', message: (err as Error).message };
      }
    },
  };
}

export type { LinearHandlerContext };
