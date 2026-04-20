import type { JiraClient } from '../jira-client.js';
import type { JiraTaskInfo } from '../types.js';

export interface MissingLabelsHandlerDeps {
  jiraClient: JiraClient;
  /** Optional template override (see `DEFAULT_MISSING_LABELS_MESSAGE`). */
  messageTemplate?: string;
}

/**
 * Markdown template posted to Jira when an `issue_created` event arrives but
 * none of the issue's labels resolve to a configured repository.
 *
 * Supports two placeholders:
 *   - `{available_labels}` — rendered as a bullet list of configured repo
 *     names the user can add to retry analysis.
 *   - `{issue_key}` — the Jira issue key for reference.
 */
export const DEFAULT_MISSING_LABELS_MESSAGE = `## I can't link this ticket to a repository yet

None of this issue's labels match a repository I know about.
Please add **one** of the following labels so I can investigate:

{available_labels}

I'll automatically pick it up as soon as the label is added.`;

export function renderMissingLabelsMessage(
  template: string,
  availableLabels: readonly string[],
  issueKey: string
): string {
  const bulletList = availableLabels.length
    ? availableLabels.map((l) => `- \`${l}\``).join('\n')
    : '_(no repositories are currently configured)_';
  return template
    .replace(/\{available_labels\}/g, bulletList)
    .replace(/\{issue_key\}/g, issueKey);
}

export async function handleMissingLabels(
  taskInfo: JiraTaskInfo,
  availableLabels: readonly string[],
  deps: MissingLabelsHandlerDeps
): Promise<void> {
  const template = deps.messageTemplate || DEFAULT_MISSING_LABELS_MESSAGE;
  const body = renderMissingLabelsMessage(template, availableLabels, taskInfo.key);
  console.warn(
    `Jira webhook: ${taskInfo.key} has no label matching a configured repo — asking reporter to add one of [${availableLabels.join(', ')}]`
  );
  await deps.jiraClient.addComment(taskInfo.key, body);
}
