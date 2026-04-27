import { StandardEvents, definePlugin, zodToPluginSchema, type TaskEvent } from '@agent-detective/sdk';
import * as z from 'zod';
import { linearAdapterOptionsSchema } from './application/options-schema.js';
import type { LinearAdapterConfig } from './application/options-schema.js';
import { createLinearGraph } from './infrastructure/linear-graph.js';
import { resolveLinearStartupAuth } from './infrastructure/resolve-linear-startup-auth.js';
import { createLinearWebhookHandler } from './application/webhook-handler.js';
import { stampComment } from './domain/comment-mark.js';
import {
  registerLinearJsonWithRawBody,
  registerLinearWebhookRoutes,
} from './presentation/linear-webhook-controller.js';
import { registerLinearOAuthRoutes } from './presentation/linear-oauth-controller.js';

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

    const auth = await resolveLinearStartupAuth(cfg, extContext.logger);
    if (!auth) {
      extContext.logger?.error(
        'linear-adapter: enabled but missing credentials — set apiKey (LINEAR_API_KEY) for a personal API token, or configure oauthClientId + oauthClientSecret + oauthRefreshToken (with apiKey as the OAuth access token, or leave apiKey empty to bootstrap from refresh_token at startup)'
      );
      return;
    }

    const mockMode = cfg.mockMode ?? true;
    const linearGraph = createLinearGraph({
      auth,
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
    registerLinearOAuthRoutes(scope, { config: cfg, logger: extContext.logger });

    const pluginPathSeg = PLUGIN_NAME.replace(/^@/, '').replace(/\//g, '-');
    const webhookUrlPath = `/plugins/${pluginPathSeg}/webhook/linear`;
    extContext.logger?.info(`Linear adapter registered at POST ${webhookUrlPath} (mockMode: ${mockMode})`);
    if (cfg.oauthClientId?.trim() && cfg.oauthClientSecret?.trim() && cfg.oauthRedirectBaseUrl?.trim()) {
      extContext.logger?.info(
        `Linear OAuth: GET /plugins/${pluginPathSeg}/oauth/start → callback under ${cfg.oauthRedirectBaseUrl.replace(/\/$/, '')}/plugins/${pluginPathSeg}/oauth/callback`
      );
    }
  },
});

export default linearAdapterPlugin;
