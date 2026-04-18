import { createJiraWebhookHandler } from './webhook-handler.js';
import { createMockJiraClient } from './mock-jira-client.js';
import { StandardEvents, type Plugin, type PluginSchema, type PluginContext } from '@agent-detective/types';
import type { MockJiraClient } from './mock-jira-client.js';
import type { JiraAdapterConfig, JiraWebhookBehavior } from './types.js';
import { registerController } from '@agent-detective/core';
import { JiraWebhookController } from './jira-webhook-controller.js';

const PLUGIN_NAME = '@agent-detective/jira-adapter';
const PLUGIN_VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0';

export const DEFAULT_WEBHOOK_BEHAVIOR: JiraWebhookBehavior = {
  defaults: {
    action: 'ignore',
    acknowledgmentMessage: 'Thanks for the update! I will review this issue and provide feedback shortly.',
  },
  events: {
    'jira:issue_created': { action: 'analyze' },
    'jira:issue_updated': { action: 'acknowledge' },
  },
};

const pluginSchema: PluginSchema = {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      default: true,
      description: 'Enable or disable the Jira adapter',
    },
    webhookPath: {
      type: 'string',
      default: '/plugins/agent-detective-jira-adapter/webhook/jira',
      description: 'Webhook endpoint path',
    },
    mockMode: {
      type: 'boolean',
      default: true,
      description: 'Use mock Jira client for testing',
    },
    analysisPrompt: {
      type: 'string',
      description: 'Custom prompt template for repository analysis',
    },
    webhookBehavior: {
      type: 'object',
      description: 'Configure behavior for each Jira webhook event type',
    },
  },
  required: [],
};

function createRealJiraClient(_config: JiraAdapterConfig): MockJiraClient {
  // TODO: Implement real Jira client
  // Requirements:
  // - Use @life-itself/jira or similar Jira REST API client
  // - Support Jira Cloud and Server/DC authentication (API tokens, OAuth)
  // - Implement webhook signature verification for incoming webhooks
  // - Handle rate limiting and retries
  // - Support: addComment, getIssue, updateIssue, getComments
  throw new Error(
    'Real Jira client not yet implemented. ' +
    'Set mockMode: true in config to use mock client. ' +
    'To implement real Jira support, see TODO in src/index.ts'
  );
}

// Config is cast through unknown since PluginContext.config is generic (Record<string, unknown>).
// The plugin schema validation ensures the config matches JiraAdapterConfig at runtime.
function asJiraAdapterConfig(context: PluginContext): JiraAdapterConfig {
  return context.config as unknown as JiraAdapterConfig;
}

const jiraAdapterPlugin: Plugin = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  schemaVersion: SCHEMA_VERSION,
  schema: pluginSchema,
  dependsOn: [],
  requiresCapabilities: ['code-analysis'],

  register(app, context) {
    const extContext = context;
    const cfg = asJiraAdapterConfig(context);

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
    context.events.on(StandardEvents.TASK_COMPLETED, async (payload: { event: any, result: string }) => {
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

    const webhookPath = cfg.webhookPath || '/plugins/agent-detective-jira-adapter/webhook/jira';

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
