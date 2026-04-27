import { StandardEvents, definePlugin, zodToPluginSchema, type TaskEvent } from '@agent-detective/sdk';
import * as z from 'zod';
import { linearAdapterOptionsSchema } from './application/options-schema.js';
import type { LinearAdapterConfig } from './application/options-schema.js';
import { createLinearGraph } from './infrastructure/linear-graph.js';
import { createLinearWebhookHandler } from './application/webhook-handler.js';
import { stampComment } from './domain/comment-mark.js';
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

    const apiKey = cfg.apiKey?.trim() ?? '';
    if (!apiKey) {
      extContext.logger?.error(
        'linear-adapter: enabled but apiKey is missing — set apiKey (or LINEAR_API_KEY) so issues and labels can be loaded'
      );
      return;
    }

    const mockMode = cfg.mockMode ?? true;
    const linearGraph = createLinearGraph({
      apiKey,
      mockComments: mockMode,
      logger: extContext.logger,
    });

    registerLinearJsonWithRawBody(scope);

    const getService = <T>(name: string): T | null => {
      try {
        return context.getService<T>(name);
      } catch {
        return null;
      }
    };

    const webhookHandler = createLinearWebhookHandler({
      linearGraph,
      config: cfg,
      events: context.events,
      logger: extContext.logger,
      getService,
    });

    context.events.on(StandardEvents.TASK_COMPLETED, async (payload: { event: TaskEvent; result: string }) => {
      const { event, result } = payload;
      if (event.metadata && (event.metadata as { workflow?: string }).workflow === 'pr') {
        return;
      }
      if (event.source === PLUGIN_NAME && event.replyTo.type === 'issue') {
        const matchedRepo =
          typeof event.metadata?.matchedRepo === 'string' && event.metadata.matchedRepo.length > 0
            ? event.metadata.matchedRepo
            : null;
        const body = stampComment(
          matchedRepo ? `## Analysis for \`${matchedRepo}\`\n\n${result}` : result
        );
        const meta = event.metadata as { linearReplyParentId?: string };
        const linearReplyParentId =
          typeof meta.linearReplyParentId === 'string' && meta.linearReplyParentId.trim().length > 0
            ? meta.linearReplyParentId.trim()
            : undefined;
        extContext.logger?.info(
          `Posting analysis back to Linear issue ${event.replyTo.id}${matchedRepo ? ` (repo=${matchedRepo})` : ''}${
            linearReplyParentId ? ` (thread=${linearReplyParentId})` : ''
          }`
        );
        try {
          await linearGraph.addIssueComment(
            event.replyTo.id,
            body,
            linearReplyParentId ? { parentId: linearReplyParentId } : undefined
          );
        } catch (err) {
          extContext.logger?.error(`Failed to post comment to Linear: ${(err as Error).message}`);
        }
      }
    });

    registerLinearWebhookRoutes(scope, { webhookHandler, config: cfg, logger: extContext.logger });

    const webhookUrlPath = `/plugins/${PLUGIN_NAME.replace(/^@/, '').replace(/\//g, '-')}/webhook/linear`;
    extContext.logger?.info(`Linear adapter registered at POST ${webhookUrlPath} (mockMode: ${mockMode})`);
  },
});

export default linearAdapterPlugin;
