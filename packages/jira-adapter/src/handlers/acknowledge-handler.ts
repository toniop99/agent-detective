import type { Logger } from '@agent-detective/types';
import type { JiraClient } from '../jira-client.js';
import type { JiraAdapterConfig, JiraTaskInfo } from '../types.js';
import { stampComment } from '../comment-trigger.js';

export interface AcknowledgeHandlerDeps {
  jiraClient: JiraClient;
  config: JiraAdapterConfig;
  logger?: Logger;
}

export async function handleAcknowledge(
  taskInfo: JiraTaskInfo,
  acknowledgmentMessage: string,
  deps: AcknowledgeHandlerDeps
): Promise<void> {
  const { jiraClient, logger } = deps;

  logger?.info(`Jira webhook: Acknowledging ${taskInfo.key}`);

  await jiraClient.addComment(taskInfo.key, stampComment(acknowledgmentMessage));
  logger?.info(`Acknowledgment comment added to ${taskInfo.key}`);
}
