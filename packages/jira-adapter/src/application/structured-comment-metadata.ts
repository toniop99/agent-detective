import type { TaskEvent } from '@agent-detective/sdk';

export const JIRA_COMMENT_METADATA_SCHEMA = 'agent-detective/jira-comment-metadata/v1' as const;

export interface JiraCommentMetadataV1 {
  schema: typeof JIRA_COMMENT_METADATA_SCHEMA;
  taskId: string;
  issueKey?: string;
  matchedRepo?: string;
  completedAt: string;
}

export function buildJiraCommentMetadata(task: TaskEvent, matchedRepo: string | null): JiraCommentMetadataV1 {
  const issueKey =
    task.replyTo?.type === 'issue' && typeof task.replyTo.id === 'string' ? task.replyTo.id : undefined;
  return {
    schema: JIRA_COMMENT_METADATA_SCHEMA,
    taskId: task.id,
    ...(issueKey ? { issueKey } : {}),
    ...(matchedRepo ? { matchedRepo } : {}),
    completedAt: new Date().toISOString(),
  };
}

/** Appends a fenced JSON block for Jira Automation / downstream parsers. */
export function appendStructuredMetadataBlock(markdownBody: string, metadata: JiraCommentMetadataV1): string {
  const json = JSON.stringify(metadata);
  return `${markdownBody}\n\n---\n**Automation metadata** (Agent Detective)\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}
