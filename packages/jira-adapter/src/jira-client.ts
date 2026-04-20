/**
 * Abstract Jira client used by handlers, the orchestrator callback in `index.ts`,
 * and the real/mock implementations. Keeping this interface stable lets us swap
 * the underlying implementation (raw fetch, jira.js SDK, or an in-memory mock)
 * without touching callers or tests.
 */
export interface JiraCommentRecord {
  text: string;
  createdAt: string;
}

export interface JiraIssueRecord {
  key: string;
  fields: Record<string, unknown>;
}

export interface JiraClient {
  addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }>;
  getIssue(issueKey: string): Promise<JiraIssueRecord | null>;
  updateIssue(issueKey: string, updates: Record<string, unknown>): Promise<{ success: boolean }>;
  getComments(issueKey: string): Promise<JiraCommentRecord[]>;
  clear(): void;
}
