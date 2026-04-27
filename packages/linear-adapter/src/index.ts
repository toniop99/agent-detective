import { StandardEvents, definePlugin, zodToPluginSchema, type TaskEvent } from '@agent-detective/sdk';
import * as z from 'zod';
import { linearAdapterOptionsSchema } from './application/options-schema.js';
import type { LinearAdapterConfig } from './application/options-schema.js';
import { createLinearWebhookHandler } from './application/webhook-handler.js';
import { createRealLinearClient } from './infrastructure/real-linear-client.js';
import {
  registerLinearJsonWithRawBody,
  registerLinearWebhookRoutes,
} from './presentation/linear-webhook-controller.js';

export { linearAdapterOptionsSchema } from './application/options-schema.js';

const PLUGIN_NAME = '@agent-detective/linear-adapter';
const PLUGIN_VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0';

const pluginSchema = zodToPluginSchema(linearAdapterOptionsSchema);

const linearAdapterPlugin = definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  schemaVersion: SCHEMA_VERSION,
  schema: pluginSchema,
  dependsOn: ['@agent-detective/local-repos-plugin'],
  requiresCapabilities: ['code-analysis'],

  async register(scope, context) {
    const extContext = context;

    const parsed = linearAdapterOptionsSchema.safeParse(context.config ?? {});
    if (!parsed.success) {
      extContext.logger?.error(`Invalid Linear adapter config: ${JSON.stringify(z.treeifyError(parsed.error))}`);
      return;
    }
    const cfg = parsed.data as LinearAdapterConfig;

    if (!cfg.enabled) {
      extContext.logger?.info(`Plugin ${PLUGIN_NAME} is disabled`);
      return;
    }

    const mockMode = cfg.mockMode ?? true;
    if (!mockMode && cfg.apiKey) {
      try {
        createRealLinearClient(cfg.apiKey, extContext.logger);
      } catch (err) {
        extContext.logger?.error(`linear-adapter: ${(err as Error).message}`);
        return;
      }
    } else if (!mockMode) {
      extContext.logger?.error('linear-adapter: mockMode is false but apiKey is missing');
      return;
    }

    registerLinearJsonWithRawBody(scope);

    const webhookHandler = createLinearWebhookHandler({ logger: extContext.logger });

    context.events.on(StandardEvents.TASK_COMPLETED, async (payload: { event: TaskEvent; result: string }) => {
      const { event, result } = payload;
      if (event.metadata && (event.metadata as { workflow?: string }).workflow === 'pr') {
        return;
      }
      if (event.source === PLUGIN_NAME && event.replyTo.type === 'issue') {
        extContext.logger?.info(
          `linear-adapter: TASK_COMPLETED for ${event.replyTo.id} — post-back to Linear not implemented (length=${String(result).length})`
        );
      }
    });

    registerLinearWebhookRoutes(scope, { webhookHandler, config: cfg, logger: extContext.logger });

    const webhookUrlPath = `/plugins/${PLUGIN_NAME.replace(/^@/, '').replace(/\//g, '-')}/webhook/linear`;
    extContext.logger?.info(`Linear adapter registered at POST ${webhookUrlPath} (mockMode: ${mockMode})`);
  },
});

export default linearAdapterPlugin;
