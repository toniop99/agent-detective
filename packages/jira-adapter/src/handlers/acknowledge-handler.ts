import type { JiraClient } from '../jira-client.js';
import type { JiraAdapterConfig, JiraTaskInfo } from '../types.js';
import { stampComment } from '../comment-trigger.js';

export interface AcknowledgeHandlerDeps {
  jiraClient: JiraClient;
  config: JiraAdapterConfig;
}

export async function handleAcknowledge(
  taskInfo: JiraTaskInfo,
  acknowledgmentMessage: string,
  deps: AcknowledgeHandlerDeps
): Promise<void> {
  const { jiraClient } = deps;

  console.warn(`Jira webhook: Acknowledging ${taskInfo.key}`);

  await jiraClient.addComment(taskInfo.key, stampComment(acknowledgmentMessage));
  console.warn(`Acknowledgment comment added to ${taskInfo.key}`);
}
