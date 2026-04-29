/**
 * Abstract Jira client used by handlers, the orchestrator callback in `index.ts`,
 * and the real/mock implementations. Keeping this interface stable lets us swap
 * the underlying implementation (raw fetch, jira.js SDK, or an in-memory mock)
 * without touching callers or tests.
 */
export interface JiraCommentRecord {
  text: string;
  createdAt: string;
  /** Present when the comment was posted as a reply in a Jira thread. */
  parentId?: string;
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

export interface JiraSubtaskCreateSpec {
  summary: string;
  description?: string;
}

export interface JiraClient {
  addComment(issueKey: string, commentText: string, options?: AddCommentOptions): Promise<{ success: boolean; issueKey: string }>;
  getIssue(issueKey: string): Promise<JiraIssueRecord | null>;
  updateIssue(issueKey: string, updates: Record<string, unknown>): Promise<{ success: boolean }>;
  getComments(issueKey: string): Promise<JiraCommentRecord[]>;
  getAttachments(issueKey: string): Promise<JiraAttachmentRecord[]>;
  downloadAttachment(attachmentId: string): Promise<Buffer>;
  /**
   * Create subtasks under a parent issue (Jira Cloud REST v3). Implementations may
   * no-op partially on failure; callers should treat thrown errors as total failure.
   */
  createSubtasks(
    parentIssueKey: string,
    specs: ReadonlyArray<JiraSubtaskCreateSpec>
  ): Promise<{ keys: string[] }>;
  clear(): void;
}
