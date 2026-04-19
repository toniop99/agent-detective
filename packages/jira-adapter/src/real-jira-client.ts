import type { JiraAdapterConfig } from './types.js';
import type { MockComment, MockIssue, MockJiraClient } from './mock-jira-client.js';

function normalizeBaseUrl(url: string): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

function buildAuthHeader(email: string, apiToken: string): string {
  const token = Buffer.from(`${email}:${apiToken}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

/** Atlassian Document Format (ADF) — minimal doc with one or more paragraphs. */
export function plainTextToAdfDoc(plainText: string): { type: string; version: number; content: unknown[] } {
  const text = String(plainText ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
    };
  }
  const chunks = text.split(/\n{2,}/);
  const content = chunks.map((chunk) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: chunk.replace(/\n+/g, ' ').trim() || ' ' }],
  }));
  return { type: 'doc', version: 1, content };
}

export function createRealJiraClient(config: JiraAdapterConfig): MockJiraClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl || '');
  const email = config.email?.trim() || '';
  const apiToken = config.apiToken?.trim() || '';

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      'Jira adapter: mockMode is false but baseUrl, email, or apiToken is missing. Set them in config or via JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.'
    );
  }

  const auth = buildAuthHeader(email, apiToken);
  const headers = {
    Authorization: auth,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  } as const;

  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    return fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
  }

  return {
    comments: new Map(),
    issues: new Map(),

    async addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }> {
      const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;
      const res = await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({
          body: plainTextToAdfDoc(commentText),
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Jira addComment failed: ${res.status} ${res.statusText} ${errBody.slice(0, 500)}`);
      }
      return { success: true, issueKey };
    },

    async getIssue(issueKey: string): Promise<MockIssue | null> {
      const res = await apiFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Jira getIssue failed: ${res.status} ${errBody.slice(0, 300)}`);
      }
      const data = (await res.json()) as { key?: string; fields?: Record<string, unknown> };
      return { key: data.key || issueKey, fields: data.fields || {} };
    },

    async updateIssue(issueKey: string, updates: Record<string, unknown>): Promise<{ success: boolean }> {
      const res = await apiFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
        method: 'PUT',
        body: JSON.stringify({ fields: updates }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Jira updateIssue failed: ${res.status} ${errBody.slice(0, 300)}`);
      }
      return { success: true };
    },

    async getComments(issueKey: string): Promise<MockComment[]> {
      const res = await apiFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Jira getComments failed: ${res.status} ${errBody.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        comments?: Array<{ body?: unknown; created?: string; renderedBody?: string }>;
      };
      const list = data.comments || [];
      return list.map((c) => ({
        text:
          typeof c.renderedBody === 'string' && c.renderedBody
            ? c.renderedBody
            : typeof c.body === 'string'
              ? c.body
              : JSON.stringify(c.body ?? ''),
        createdAt: c.created || new Date().toISOString(),
      }));
    },

    clear(): void {
      /* no-op for REST client */
    },
  };
}
