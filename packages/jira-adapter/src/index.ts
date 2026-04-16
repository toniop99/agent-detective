import { createJiraWebhookHandler } from './webhook-handler.js';
import { createMockJiraClient } from './mock-jira-client.js';
import type { Plugin, PluginSchema, PluginContext } from '@agent-detective/types';
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
    discoveryPrompt: {
      type: 'string',
      description: 'Custom prompt template for repository discovery',
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

interface LocalReposContext {
  repos: Array<{
    name: string;
    path: string;
    exists: boolean;
    techStack: string[];
    summary: string;
  }>;
  getRepo(name: string): { name: string; path: string; exists: boolean; techStack: string[]; summary: string } | null;
  getAllRepos(): Array<{ name: string; path: string; exists: boolean; techStack: string[]; summary: string }>;
}

// Note: local-repos-plugin data is now accessed via context.plugins['@agent-detective/local-repos-plugin']
type JiraAdapterPluginContext = PluginContext;

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
  dependsOn: ['@agent-detective/local-repos-plugin'],

  register(app, context) {
    const extContext = context as JiraAdapterPluginContext;
    const cfg = asJiraAdapterConfig(context);

    if (!cfg.enabled) {
      extContext.logger?.info(`Plugin ${PLUGIN_NAME} is disabled`);
      return;
    }

    const localReposData = context.plugins['@agent-detective/local-repos-plugin'];
    if (!localReposData?.localRepos) {
      throw new Error(`${PLUGIN_NAME} requires @agent-detective/local-repos-plugin to be loaded as a dependency`);
    }
    const localRepos = localReposData.localRepos as LocalReposContext;

    if (!extContext.agentRunner) {
      extContext.logger?.error('Agent runner not available');
      return;
    }

    if (!extContext.enqueue) {
      extContext.logger?.error('Enqueue function not available - core plugin system not properly initialized');
      return;
    }

    const mockMode = cfg.mockMode ?? true;
    const jiraClient = mockMode
      ? createMockJiraClient()
      : createRealJiraClient(cfg);

    const webhookHandler = createJiraWebhookHandler({
      jiraClient,
      config: cfg,
      agentRunner: extContext.agentRunner,
      enqueue: extContext.enqueue,
      getAvailableRepos: () => {
        const repos = localRepos.getAllRepos();
        return repos.filter((r) => r.exists);
      },
      buildRepoContext: localReposData.buildRepoContext as (repoPath: string, options?: unknown) => Promise<unknown>,
      formatRepoContextForPrompt: localReposData.formatRepoContextForPrompt as (context: unknown) => string,
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
