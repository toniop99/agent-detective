import { createJiraWebhookHandler } from './webhook-handler.js';
import { createMockJiraClient } from './mock-jira-client.js';
import type { Plugin, PluginSchema, AgentRunner, EnqueueFn } from '@agent-detective/types';
import type { MockJiraClient } from './mock-jira-client.js';
import type { JiraAdapterConfig, JiraWebhookBehavior } from './types.js';

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
  throw new Error('Real Jira client not yet implemented');
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

interface ExtendedContext {
  localRepos?: LocalReposContext;
  buildRepoContext?: (repoPath: string, options?: unknown) => Promise<unknown>;
  formatRepoContextForPrompt?: (context: unknown) => string;
  enqueue?: EnqueueFn;
  config: Record<string, unknown>;
  agentRunner?: AgentRunner;
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

const jiraAdapterPlugin: Plugin = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  schemaVersion: SCHEMA_VERSION,
  schema: pluginSchema,
  dependsOn: ['@agent-detective/local-repos-plugin'],

  register(app, context) {
    const extContext = context as unknown as ExtendedContext;
    const cfg = extContext.config as unknown as JiraAdapterConfig;

    if (!cfg.enabled) {
      extContext.logger?.info(`Plugin ${PLUGIN_NAME} is disabled`);
      return;
    }

    if (!extContext.localRepos) {
      extContext.logger?.warn(`${PLUGIN_NAME} requires local-repos-plugin to be loaded first`);
      return;
    }

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
        const repos = extContext.localRepos!.getAllRepos();
        return repos.filter((r) => r.exists);
      },
      buildRepoContext: extContext.buildRepoContext!,
      formatRepoContextForPrompt: extContext.formatRepoContextForPrompt!,
    });

    const webhookPath = cfg.webhookPath || '/plugins/agent-detective-jira-adapter/webhook/jira';

    app.post(webhookPath, async (req, res) => {
      try {
        const webhookEvent = req.body?.webhookEvent || 'unknown';
        const result = await webhookHandler.handleWebhook(req.body, webhookEvent);
        res.json(result);
      } catch (err) {
        extContext.logger?.error(`Jira webhook error: ${(err as Error).message}`);
        res.status(500).json({ error: (err as Error).message });
      }
    });

    extContext.logger?.info(`Jira adapter registered at ${webhookPath} (mockMode: ${mockMode})`);
  },
};

export default jiraAdapterPlugin;
