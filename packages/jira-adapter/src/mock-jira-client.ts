export interface MockComment {
  text: string;
  createdAt: string;
}

export interface MockIssue {
  key: string;
  fields: Record<string, unknown>;
}

/**
 * Mock Jira client for testing.
 * Stores comments in memory instead of making real API calls.
 */
export interface MockJiraClient {
  comments: Map<string, MockComment[]>;
  issues: Map<string, MockIssue>;
  addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }>;
  getIssue(issueKey: string): Promise<MockIssue | null>;
  updateIssue(issueKey: string, updates: Record<string, unknown>): Promise<{ success: boolean }>;
  getComments(issueKey: string): Promise<MockComment[]>;
  clear(): void;
}

export function createMockJiraClient(): MockJiraClient {
  const comments = new Map<string, MockComment[]>();
  const issues = new Map<string, MockIssue>();

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
      console.warn(`[MOCK] Added comment to ${issueKey}: ${commentText.slice(0, 50)}...`);
      return { success: true, issueKey };
    },

    async getIssue(issueKey: string): Promise<MockIssue | null> {
      return issues.get(issueKey) || null;
    },

    async updateIssue(issueKey: string, updates: Record<string, unknown>): Promise<{ success: boolean }> {
      const issue = issues.get(issueKey) || { key: issueKey, fields: {} };
      Object.assign(issue.fields, updates);
      issues.set(issueKey, issue);
      return { success: true };
    },

    async getComments(issueKey: string): Promise<MockComment[]> {
      return comments.get(issueKey) || [];
    },

    clear(): void {
      comments.clear();
      issues.clear();
    },
  };
}
