import type { TaskEvent } from '@agent-detective/types';
import type { JiraIssue, JiraDescription, JiraPayload } from './types.js';

export function normalizeJiraPayload(payload: JiraPayload): TaskEvent {
  const issue = payload.issue || ({} as JiraIssue);

  const id = issue.key || issue.id || String(Date.now());
  const title = issue.fields?.summary || '';
  const description = extractDescription(issue);
  const labels = issue.fields?.labels || [];
  const projectKey = issue.fields?.project?.key || '';
  const projectName = issue.fields?.project?.name || '';

  const metadata: Record<string, unknown> = {
    labels,
    projectKey,
    projectName,
    issueType: issue.fields?.issuetype?.name || 'Task',
    reporter: issue.fields?.reporter?.displayName || 'unknown',
    assignee: issue.fields?.assignee?.displayName || null,
    priority: issue.fields?.priority?.name || 'Medium',
    status: issue.fields?.status?.name || 'Open',
    created: issue.fields?.created ? String(issue.fields.created) : new Date().toISOString(),
    timestamp: payload.timestamp || Date.now(),
    webhookEvent: payload.webhookEvent || 'unknown',
    user: payload.user ? {
      accountId: payload.user.accountId,
      displayName: payload.user.displayName,
      emailAddress: payload.user.emailAddress,
    } : null,
  };

  return {
    id,
    type: 'incident',
    source: 'jira',
    message: buildIncidentMessage(title, description),
    context: {
      repoPath: null,
      threadId: null,
      cwd: process.cwd(),
    },
    replyTo: {
      type: 'issue',
      id,
    },
    metadata,
  };
}

function extractDescription(issue: JiraIssue): string {
  if (!issue.fields) return (issue as unknown as { description?: string }).description || '';

  const desc = issue.fields.description;
  if (typeof desc === 'string') return desc;
  if (desc && typeof desc === 'object' && 'content' in desc) {
    return (desc as JiraDescription).content
      .map((block) => {
        if (block.content) {
          return block.content.map((text) => text.text || '').join('');
        }
        return block.text || '';
      })
      .join('\n');
  }
  return '';
}

function buildIncidentMessage(title: string, description: string): string {
  const parts: string[] = [`## Incident: ${title}`];

  if (description) {
    parts.push('\n### Description');
    parts.push(description);
  }

  return parts.join('\n');
}

export function extractLabelsFromPayload(payload: JiraPayload): string[] {
  const issue = payload.issue || ({} as JiraIssue);
  return issue.fields?.labels || [];
}

export function extractProjectKeyFromPayload(payload: JiraPayload): string {
  const issue = payload.issue || ({} as JiraIssue);
  return issue.fields?.project?.key || '';
}

export function extractProjectNameFromPayload(payload: JiraPayload): string {
  const issue = payload.issue || ({} as JiraIssue);
  return issue.fields?.project?.name || '';
}
