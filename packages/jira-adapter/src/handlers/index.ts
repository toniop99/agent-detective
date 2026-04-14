import type { JiraAdapterConfig, JiraWebhookEventType, JiraEventConfig, JiraTaskInfo } from '../types.js';
import { getDefaultAcknowledgmentMessage } from '../types.js';
import { handleAnalyze, AnalyzeHandlerDeps } from './analyze-handler.js';
import { handleAcknowledge, AcknowledgeHandlerDeps } from './acknowledge-handler.js';
import { handleIgnore, IgnoreHandlerDeps } from './ignore-handler.js';

export interface HandlerContext {
  jiraClient: AnalyzeHandlerDeps['jiraClient'];
  config: JiraAdapterConfig;
  agentRunner: AnalyzeHandlerDeps['agentRunner'];
  enqueue: AnalyzeHandlerDeps['enqueue'];
  getAvailableRepos: AnalyzeHandlerDeps['getAvailableRepos'];
  buildRepoContext: AnalyzeHandlerDeps['buildRepoContext'];
  formatRepoContextForPrompt: AnalyzeHandlerDeps['formatRepoContextForPrompt'];
}

function getEventConfig(
  webhookEvent: string,
  config: JiraAdapterConfig
): JiraEventConfig {
  const behavior = config.webhookBehavior;
  if (!behavior) {
    return { action: 'ignore' };
  }

  const eventType = webhookEvent as JiraWebhookEventType;
  const eventConfig = behavior.events?.[eventType];

  if (eventConfig) {
    return {
      ...behavior.defaults,
      ...eventConfig,
    };
  }

  return behavior.defaults || { action: 'ignore' };
}

export async function routeToHandler(
  payload: unknown,
  taskInfo: JiraTaskInfo,
  webhookEvent: string,
  context: HandlerContext
): Promise<void> {
  const { config, jiraClient, agentRunner, enqueue, getAvailableRepos, buildRepoContext, formatRepoContextForPrompt } = context;

  const eventConfig = getEventConfig(webhookEvent, config);

  switch (eventConfig.action) {
    case 'analyze': {
      const analyzeDeps: AnalyzeHandlerDeps = {
        jiraClient,
        config,
        agentRunner,
        enqueue,
        getAvailableRepos,
        buildRepoContext,
        formatRepoContextForPrompt,
      };
      await handleAnalyze(payload, taskInfo, analyzeDeps);
      break;
    }

    case 'acknowledge': {
      const acknowledgeDeps: AcknowledgeHandlerDeps = {
        jiraClient,
        config,
      };
      const message = eventConfig.acknowledgmentMessage || getDefaultAcknowledgmentMessage();
      await handleAcknowledge(taskInfo, message, acknowledgeDeps);
      break;
    }

    case 'ignore':
    default: {
      const ignoreDeps: IgnoreHandlerDeps = {
        webhookEvent,
      };
      await handleIgnore(taskInfo, ignoreDeps);
      break;
    }
  }
}
