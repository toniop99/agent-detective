import type { JiraTaskInfo } from '../types.js';

export interface IgnoreHandlerDeps {
  webhookEvent: string;
}

export async function handleIgnore(
  taskInfo: JiraTaskInfo,
  _deps: IgnoreHandlerDeps
): Promise<void> {
  console.warn(`Jira webhook: Ignoring ${taskInfo.key} (event: ${_deps.webhookEvent})`);
}
