import type { Logger } from '@agent-detective/sdk';
import type {
  AddCommentOptions,
  JiraAttachmentRecord,
  JiraClient,
  JiraCommentRecord,
  JiraIssueRecord,
  JiraSubtaskCreateSpec,
} from './jira-client.js';

export type {
  JiraAttachmentRecord,
  JiraClient,
  JiraCommentRecord,
  JiraIssueRecord,
  JiraSubtaskCreateSpec,
} from './jira-client.js';

/**
 * Mock Jira client for testing.
 * Stores comments in memory instead of making real API calls.
 */
export interface MockJiraClientWithStore extends JiraClient {
  comments: Map<string, JiraCommentRecord[]>;
  issues: Map<string, JiraIssueRecord>;
}

export function createMockJiraClient(options?: { logger?: Pick<Logger, 'warn' | 'info'> }): MockJiraClientWithStore {
  const { logger } = options ?? {};
  const comments = new Map<string, JiraCommentRecord[]>();
  const issues = new Map<string, JiraIssueRecord>();
  let mockIssueSeq = 1;
  const log = (line: string) => {
    if (logger?.warn) {
      logger.warn(line);
    } else {
      logger?.info?.(line);
    }
  };

  return {
    comments,
    issues,

    async addComment(
      issueKey: string,
      commentText: string,
      options?: AddCommentOptions
    ): Promise<{ success: boolean; issueKey: string }> {
      if (!comments.has(issueKey)) {
        comments.set(issueKey, []);
      }
      comments.get(issueKey)!.push({
        text: commentText,
        createdAt: new Date().toISOString(),
        ...(options?.parentId ? { parentId: options.parentId } : {}),
      });
      const banner = '─'.repeat(60);
      log(
        `[MOCK] Added comment to ${issueKey} (length=${commentText.length} chars)\n${banner}\n${commentText}\n${banner}`,
      );
      return { success: true, issueKey };
    },

    async getIssue(issueKey: string): Promise<JiraIssueRecord | null> {
      return issues.get(issueKey) || null;
    },

    async updateIssue(issueKey: string, updates: Record<string, unknown>): Promise<{ success: boolean }> {
      const issue = issues.get(issueKey) || { key: issueKey, fields: {} };
      Object.assign(issue.fields, updates);
      issues.set(issueKey, issue);
      return { success: true };
    },

    async getComments(issueKey: string): Promise<JiraCommentRecord[]> {
      return comments.get(issueKey) || [];
    },

    async getAttachments(_issueKey: string): Promise<JiraAttachmentRecord[]> {
      return [];
    },

    async downloadAttachment(_attachmentId: string): Promise<Buffer> {
      return Buffer.alloc(0);
    },

    async createSubtasks(
      parentIssueKey: string,
      specs: ReadonlyArray<JiraSubtaskCreateSpec>
    ): Promise<{ keys: string[] }> {
      const keys: string[] = [];
      for (const spec of specs) {
        const key = `MOCK-SUB-${mockIssueSeq++}`;
        keys.push(key);
        issues.set(key, {
          key,
          fields: {
            summary: spec.summary,
            description: spec.description,
            parent: { key: parentIssueKey },
          },
        });
      }
      const banner = '─'.repeat(40);
      log(
        `[MOCK] createSubtasks under ${parentIssueKey}: ${keys.join(', ')}\n${banner}\n${specs
          .map((s) => s.summary)
          .join('\n')}\n${banner}`
      );
      return { keys };
    },

    clear(): void {
      comments.clear();
      issues.clear();
      mockIssueSeq = 1;
    },
  };
}
