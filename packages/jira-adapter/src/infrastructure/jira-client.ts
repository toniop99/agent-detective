/**
 * Abstract Jira client used by handlers, the orchestrator callback in `index.ts`,
 * and the real/mock implementations. Keeping this interface stable lets us swap
 * the underlying implementation (raw fetch, jira.js SDK, or an in-memory mock)
 * without touching callers or tests.
 */
export interface JiraCommentRecord {
  text: string;
  createdAt: string;
  author?: { accountId?: string; emailAddress?: string; displayName?: string };
}

export interface JiraIssueRecord {
  key: string;
  fields: Record<string, unknown>;
}

export interface AddCommentOptions {
  parentId?: string;
}

export interface JiraAttachmentRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface JiraClient {
  addComment(issueKey: string, commentText: string, options?: AddCommentOptions): Promise<{ success: boolean; issueKey: string }>;
  getIssue(issueKey: string): Promise<JiraIssueRecord | null>;
  updateIssue(issueKey: string, updates: Record<string, unknown>): Promise<{ success: boolean }>;
  getComments(issueKey: string): Promise<JiraCommentRecord[]>;
  getAttachments(issueKey: string): Promise<JiraAttachmentRecord[]>;
  downloadAttachment(attachmentId: string): Promise<Buffer>;
  clear(): void;
}
