import { StandardEvents, type EventBus, type Logger } from '@agent-detective/types';
import type { JiraAdapterConfig, JiraWebhookEventType, JiraEventConfig, JiraTaskInfo } from '../types.js';
import { getDefaultAcknowledgmentMessage } from '../types.js';
import { handleAcknowledge, AcknowledgeHandlerDeps } from './acknowledge-handler.js';
import { handleIgnore, IgnoreHandlerDeps } from './ignore-handler.js';

export interface HandlerContext {
  jiraClient: AcknowledgeHandlerDeps['jiraClient'];
  config: JiraAdapterConfig;
  events: EventBus;
  logger?: Logger;
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
  _payload: unknown,
  taskInfo: JiraTaskInfo,
  webhookEvent: string,
  context: HandlerContext
): Promise<void> {
  const { config, jiraClient, events } = context;

  const eventConfig = getEventConfig(webhookEvent, config);

  switch (eventConfig.action) {
    case 'analyze': {
      events.emit(StandardEvents.TASK_CREATED, {
        id: taskInfo.key,
        type: 'incident',
        source: '@agent-detective/jira-adapter',
        message: taskInfo.description,
        context: {
          repoPath: null,
          threadId: null,
          cwd: process.cwd(),
        },
        replyTo: {
          type: 'issue',
          id: taskInfo.key,
        },
        metadata: {
          labels: taskInfo.labels,
          projectKey: taskInfo.projectKey,
          requiresCodeContext: true,
          analysisPrompt: eventConfig.analysisPrompt || config.analysisPrompt,
        },
      });
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
