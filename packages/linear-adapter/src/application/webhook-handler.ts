import type { Logger } from '@agent-detective/sdk';

export type LinearWebhookHandleResult = {
  status: 'success' | 'ignored' | 'error';
  message?: string;
};

export function createLinearWebhookHandler(deps: { logger?: Logger }) {
  const { logger } = deps;
  return {
    async handleWebhook(body: Record<string, unknown>): Promise<LinearWebhookHandleResult> {
      const action = typeof body.action === 'string' ? body.action : 'unknown';
      const type = typeof body.type === 'string' ? body.type : 'unknown';
      logger?.info(
        `linear-adapter: webhook accepted type=${type} action=${action} (task enqueue not yet implemented)`
      );
      return {
        status: 'ignored',
        message: 'Linear adapter received webhook; issue/comment → task routing is not implemented yet',
      };
    },
  };
}
