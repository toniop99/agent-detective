import type { Logger } from '@agent-detective/sdk';
import type { LinearGraph } from '../infrastructure/linear-graph.js';
import type { LinearTaskInfo } from '../domain/types.js';
import { stampComment } from '../domain/comment-mark.js';

export const DEFAULT_MISSING_LABELS_MESSAGE = `## I can't link this issue to a repository yet

None of this issue's labels match a repository I know about.
Please add **one** of the following labels so I can investigate:

{available_labels}

Once the label is set, leave a comment containing \`{trigger_phrase}\` and I'll pick it up and analyze the issue.`;

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

export async function postMissingLabelsComment(
  taskInfo: LinearTaskInfo,
  availableLabels: readonly string[],
  deps: {
    graph: LinearGraph;
    messageTemplate?: string;
    triggerPhrase: string;
    logger?: Logger;
    replyParentCommentId?: string;
  }
): Promise<void> {
  const template = deps.messageTemplate || DEFAULT_MISSING_LABELS_MESSAGE;
  const body = renderMissingLabelsMessage(template, availableLabels, taskInfo.key, deps.triggerPhrase);
  deps.logger?.warn(
    `linear-adapter: ${taskInfo.key} has no label matching a configured repo — posting reminder (add one of [${availableLabels.join(', ')}])`
  );
  await deps.graph.addIssueComment(
    taskInfo.issueUuid,
    stampComment(body),
    deps.replyParentCommentId ? { parentId: deps.replyParentCommentId } : undefined
  );
}
