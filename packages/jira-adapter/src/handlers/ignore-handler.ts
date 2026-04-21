import type { Logger } from '@agent-detective/types';
import type { JiraTaskInfo } from '../types.js';

export interface IgnoreHandlerDeps {
  webhookEvent: string;
  logger?: Logger;
}

export async function handleIgnore(
  taskInfo: JiraTaskInfo,
  _deps: IgnoreHandlerDeps
): Promise<void> {
  _deps.logger?.info(`Jira webhook: Ignoring ${taskInfo.key} (event: ${_deps.webhookEvent})`);
}
