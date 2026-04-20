import type { JiraClient, JiraCommentRecord, JiraIssueRecord } from './jira-client.js';

export type { JiraClient, JiraCommentRecord, JiraIssueRecord } from './jira-client.js';

/** @deprecated Use {@link JiraClient}. Retained for backwards compatibility. */
export type MockJiraClient = JiraClient;
/** @deprecated Use {@link JiraCommentRecord}. Retained for backwards compatibility. */
export type MockComment = JiraCommentRecord;
/** @deprecated Use {@link JiraIssueRecord}. Retained for backwards compatibility. */
export type MockIssue = JiraIssueRecord;

/**
 * Mock Jira client for testing.
 * Stores comments in memory instead of making real API calls.
 */
export interface MockJiraClientWithStore extends JiraClient {
  comments: Map<string, JiraCommentRecord[]>;
  issues: Map<string, JiraIssueRecord>;
}

export function createMockJiraClient(): MockJiraClientWithStore {
  const comments = new Map<string, JiraCommentRecord[]>();
  const issues = new Map<string, JiraIssueRecord>();

  return {
    comments,
    issues,

    async addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }> {
      if (!comments.has(issueKey)) {
        comments.set(issueKey, []);
      }
      comments.get(issueKey)!.push({
        text: commentText,
        createdAt: new Date().toISOString(),
      });
      const banner = '─'.repeat(60);
      console.warn(
        `[MOCK] Added comment to ${issueKey} (length=${commentText.length} chars)\n${banner}\n${commentText}\n${banner}`
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

    clear(): void {
      comments.clear();
      issues.clear();
    },
  };
}
