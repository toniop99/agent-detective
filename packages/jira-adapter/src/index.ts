import { createJiraWebhookHandler } from './webhook-handler.js';
import { createMockJiraClient } from './mock-jira-client.js';
import { createRealJiraClient } from './real-jira-client.js';
import { StandardEvents, type Plugin, type TaskEvent } from '@agent-detective/types';
import type { JiraAdapterConfig } from './types.js';
import { registerController } from '@agent-detective/core';
import { JiraWebhookController } from './jira-webhook-controller.js';
import * as z from 'zod';
import { jiraAdapterOptionsSchema } from './options-schema.js';
import { zodToPluginSchema } from '@agent-detective/core';
import { stampComment } from './comment-trigger.js';

export { DEFAULT_WEBHOOK_BEHAVIOR, jiraAdapterOptionsSchema } from './options-schema.js';

const PLUGIN_NAME = '@agent-detective/jira-adapter';
const PLUGIN_VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0';

const pluginSchema = zodToPluginSchema(jiraAdapterOptionsSchema);

const jiraAdapterPlugin: Plugin = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  schemaVersion: SCHEMA_VERSION,
  schema: pluginSchema,
  dependsOn: ['@agent-detective/local-repos-plugin'],
  requiresCapabilities: ['code-analysis'],

  register(app, context) {
    const extContext = context;

    const parsed = jiraAdapterOptionsSchema.safeParse(context.config ?? {});
    if (!parsed.success) {
      extContext.logger?.error(`Invalid Jira adapter config: ${JSON.stringify(z.treeifyError(parsed.error))}`);
      return;
    }
    const cfg = parsed.data as JiraAdapterConfig;

    if (!cfg.enabled) {
      extContext.logger?.info(`Plugin ${PLUGIN_NAME} is disabled`);
      return;
    }

    const mockMode = cfg.mockMode ?? true;
    const jiraClient = mockMode
      ? createMockJiraClient({ logger: extContext.logger })
      : createRealJiraClient(cfg, { logger: extContext.logger });

    const webhookHandler = createJiraWebhookHandler({
      jiraClient,
      config: cfg,
      events: context.events,
      logger: extContext.logger,
      // Soft service lookup: `PluginContext.getService` throws when a service
      // isn't registered, but handlers treat "no matcher" as "skip analysis".
      // Wrap it so handlers can stay declarative.
      getService: <T>(name: string): T | null => {
        try {
          return context.getService<T>(name);
        } catch {
          return null;
        }
      },
    });

    // Listen for completed tasks and post back to Jira. When the analysis was
    // fanned out across multiple repos, `event.metadata.matchedRepo` is set
    // per-task and we prepend a heading so a reader can tell the comments
    // apart on the ticket.
    context.events.on(StandardEvents.TASK_COMPLETED, async (payload: { event: TaskEvent; result: string }) => {
      const { event, result } = payload;
      if (event.source === PLUGIN_NAME && event.replyTo.type === 'issue') {
        const matchedRepo =
          typeof event.metadata?.matchedRepo === 'string' && event.metadata.matchedRepo.length > 0
            ? event.metadata.matchedRepo
            : null;
        const body = stampComment(
          matchedRepo ? `## Analysis for \`${matchedRepo}\`\n\n${result}` : result
        );
        const resultLength = typeof result === 'string' ? result.length : 0;
        const resultPreview = typeof result === 'string' ? result.slice(0, 120).replace(/\s+/g, ' ') : '';
        extContext.logger?.info(
          `Posting result back to Jira issue ${event.replyTo.id}${
            matchedRepo ? ` (repo=${matchedRepo})` : ''
          } (length=${resultLength}) preview="${resultPreview}${resultLength > 120 ? '…' : ''}"`
        );
        try {
          await jiraClient.addComment(event.replyTo.id, body);
        } catch (err) {
          extContext.logger?.error(`Failed to post comment to Jira: ${(err as Error).message}`);
        }
      }
    });

    const webhookController = new JiraWebhookController();
    webhookController.setWebhookHandler(webhookHandler);
    if (extContext.logger) {
      webhookController.setLogger(extContext.logger);
    }
    registerController(app, webhookController);

    const webhookUrlPath = `/plugins/${PLUGIN_NAME.replace(/^@/, '').replace(/\//g, '-')}/webhook/jira`;
    extContext.logger?.info(`Jira adapter registered at POST ${webhookUrlPath} (mockMode: ${mockMode})`);

    return [webhookController];
  },
};

export default jiraAdapterPlugin;
