import { createJiraWebhookHandler } from './webhook-handler.js';
import { createMockJiraClient } from './mock-jira-client.js';
import { createRealJiraClient } from './real-jira-client.js';
import { StandardEvents, type Plugin, type TaskEvent } from '@agent-detective/types';
import type { JiraAdapterConfig } from './types.js';
import { registerController } from '@agent-detective/core';
import { JiraWebhookController } from './jira-webhook-controller.js';
import * as z from 'zod';
import { jiraAdapterOptionsSchema } from './options-schema.js';
import { zodToPluginSchema } from './zod-to-plugin-schema.js';

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
  dependsOn: [],
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
      ? createMockJiraClient()
      : createRealJiraClient(cfg);

    const webhookHandler = createJiraWebhookHandler({
      jiraClient,
      config: cfg,
      events: context.events,
    });

    // Listen for completed tasks and post back to Jira
    context.events.on(StandardEvents.TASK_COMPLETED, async (payload: { event: TaskEvent; result: string }) => {
      const { event, result } = payload;
      if (event.source === PLUGIN_NAME && event.replyTo.type === 'issue') {
        extContext.logger?.info(`Posting result back to Jira issue ${event.replyTo.id}`);
        try {
          await jiraClient.addComment(event.replyTo.id, result);
        } catch (err) {
          extContext.logger?.error(`Failed to post comment to Jira: ${(err as Error).message}`);
        }
      }
    });

    const webhookPath = cfg.webhookPath;

    const webhookController = new JiraWebhookController();
    webhookController.setWebhookHandler(webhookHandler);
    if (extContext.logger) {
      webhookController.setLogger(extContext.logger);
    }
    registerController(app, webhookController);

    extContext.logger?.info(`Jira adapter registered at ${webhookPath} (mockMode: ${mockMode})`);

    return [webhookController];
  },
};

export default jiraAdapterPlugin;
