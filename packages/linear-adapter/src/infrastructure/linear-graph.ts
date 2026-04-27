import { LinearClient } from '@linear/sdk';
import type { Logger } from '@agent-detective/sdk';
import type { LinearTaskInfo } from '../domain/types.js';
import { stampComment } from '../domain/comment-mark.js';

export interface LinearGraph {
  addIssueComment(issueId: string, body: string, opts?: { parentId?: string }): Promise<void>;
  fetchIssue(issueId: string): Promise<LinearTaskInfo>;
}

export function createLinearGraph(deps: {
  apiKey: string;
  mockComments: boolean;
  logger?: Logger;
}): LinearGraph {
  const client = new LinearClient({ apiKey: deps.apiKey.trim() });
  return {
    async addIssueComment(issueId, body, opts) {
      const stamped = stampComment(body);
      if (deps.mockComments) {
        deps.logger?.info(
          `[MOCK Linear] comment issue=${issueId} parent=${opts?.parentId ?? '(root)'} len=${stamped.length}`
        );
        return;
      }
      await client.createComment({
        issueId,
        body: stamped,
        ...(opts?.parentId ? { parentId: opts.parentId } : {}),
      });
    },
    async fetchIssue(issueId) {
      const issue = await client.issue(issueId);
      const labelConn = await issue.labels({ first: 100 });
      const nodes = labelConn.nodes ?? [];
      const labels = nodes.map((n) => n.name).filter((n): n is string => Boolean(n));
      const ident = issue.identifier ?? issueId;
      const projectKey = ident.includes('-') ? ident.split('-')[0]! : 'LINEAR';
      return {
        issueUuid: issue.id,
        key: ident,
        summary: issue.title,
        description: issue.description ?? '',
        projectKey,
        labels,
      };
    },
  };
}
