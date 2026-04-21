import type { JiraClient } from '../jira-client.js';
import type { JiraTaskInfo } from '../types.js';
import { stampComment } from '../comment-trigger.js';

export interface MissingLabelsHandlerDeps {
  jiraClient: JiraClient;
  /** Optional template override (see `DEFAULT_MISSING_LABELS_MESSAGE`). */
  messageTemplate?: string;
  /** Phrase the reminder should tell the user to post to retry analysis. */
  triggerPhrase: string;
}

/**
 * Markdown template posted to Jira when an `issue_created` event (or a
 * comment-triggered retry) resolves to no matching repo. Two placeholders
 * are supported:
 *
 *   - `{available_labels}` — rendered as a bullet list of configured repo
 *     names the user can add.
 *   - `{issue_key}` — the Jira issue key for reference.
 *   - `{trigger_phrase}` — the exact phrase the user has to include in a
 *     comment to kick off a retry once they've added a matching label.
 *
 * The retry instruction is part of the default copy because the adapter no
 * longer auto-retries on `issue_updated`: a fresh comment containing the
 * trigger phrase is the only way to re-run the match.
 */
export const DEFAULT_MISSING_LABELS_MESSAGE = `## I can't link this ticket to a repository yet

None of this issue's labels match a repository I know about.
Please add **one** of the following labels so I can investigate:

{available_labels}

Once the label is set, leave a comment containing \`{trigger_phrase}\` and I'll pick it up and analyze the ticket.`;

export function renderMissingLabelsMessage(
  template: string,
  availableLabels: readonly string[],
  issueKey: string,
  triggerPhrase: string
): string {
  const bulletList = availableLabels.length
    ? availableLabels.map((l) => `- \`${l}\``).join('\n')
    : '_(no repositories are currently configured)_';
  return template
    .replace(/\{available_labels\}/g, bulletList)
    .replace(/\{issue_key\}/g, issueKey)
    .replace(/\{trigger_phrase\}/g, triggerPhrase);
}

export async function handleMissingLabels(
  taskInfo: JiraTaskInfo,
  availableLabels: readonly string[],
  deps: MissingLabelsHandlerDeps
): Promise<void> {
  const template = deps.messageTemplate || DEFAULT_MISSING_LABELS_MESSAGE;
  const body = renderMissingLabelsMessage(
    template,
    availableLabels,
    taskInfo.key,
    deps.triggerPhrase
  );
  console.warn(
    `Jira webhook: ${taskInfo.key} has no label matching a configured repo — asking reporter to add one of [${availableLabels.join(', ')}] and comment "${deps.triggerPhrase}"`
  );
  await deps.jiraClient.addComment(taskInfo.key, stampComment(body));
}
