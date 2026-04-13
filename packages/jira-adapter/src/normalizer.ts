import type { TaskEvent } from '@agent-detective/types';

interface JiraIssue {
  key?: string;
  id?: string;
  fields?: {
    summary?: string;
    description?: string | JiraDescription;
    labels?: string[];
    project?: { key?: string };
    issuetype?: { name?: string };
    reporter?: { displayName?: string };
    priority?: { name?: string };
    status?: { name?: string };
    created?: string;
  };
  title?: string;
  labels?: string[];
  projectKey?: string;
  issueType?: string;
  reporter?: string;
  priority?: string;
  status?: string;
  created?: string;
}

interface JiraDescription {
  content?: Array<{
    content?: Array<{ text?: string }>;
    text?: string;
  }>;
}

interface JiraPayload {
  issue?: JiraIssue;
}

export function normalizeJiraPayload(payload: JiraPayload): TaskEvent {
  const issue = payload.issue || ({} as JiraIssue);

  const id = issue.key || issue.id || String(Date.now());
  const title = issue.fields?.summary || issue.title || '';
  const description = extractDescription(issue);
  const labels = issue.fields?.labels || issue.labels || [];
  const projectKey = issue.fields?.project?.key || issue.projectKey || '';

  const metadata: Record<string, unknown> = {
    labels,
    projectKey,
    issueType: issue.fields?.issuetype?.name || issue.issueType || 'Task',
    reporter: issue.fields?.reporter?.displayName || issue.reporter || 'unknown',
    priority: issue.fields?.priority?.name || issue.priority || 'Medium',
    status: issue.fields?.status?.name || issue.status || 'Open',
    created: issue.fields?.created || issue.created || new Date().toISOString(),
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
  if (desc?.content) {
    return desc.content
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
  return issue.fields?.labels || issue.labels || [];
}

export function extractProjectKeyFromPayload(payload: JiraPayload): string {
  const issue = payload.issue || ({} as JiraIssue);
  return issue.fields?.project?.key || issue.projectKey || '';
}
