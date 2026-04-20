import { Version3Client } from 'jira.js';
import { HttpException } from 'jira.js';
import type { JiraAdapterConfig } from './types.js';
import type { JiraClient, JiraCommentRecord, JiraIssueRecord } from './jira-client.js';
import { markdownToAdfDoc, type AdfDoc } from './markdown-to-adf.js';

function normalizeBaseUrl(url: string): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

/** Minimal jira.js Version3Client surface used by this adapter. Enables test stubs. */
export type Version3ClientSurface = Pick<Version3Client, 'issues' | 'issueComments'>;

/**
 * Convert a plain-text (or single-paragraph) string into an ADF doc. Kept as a
 * named export for backward compatibility and for callers that really don't
 * want Markdown parsing. New code should prefer {@link markdownToAdfDoc}.
 */
export function plainTextToAdfDoc(plainText: string): AdfDoc {
  const text = String(plainText ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph' }],
    };
  }
  const chunks = text.split(/\n{2,}/);
  return {
    type: 'doc',
    version: 1,
    content: chunks.map((chunk) => {
      const line = chunk.replace(/\n+/g, ' ').trim();
      return line
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' };
    }),
  };
}

export { markdownToAdfDoc } from './markdown-to-adf.js';

export interface RealJiraClientOverrides {
  /** Inject a Version3Client (or compatible stub) to bypass the real HTTP stack in tests. */
  client?: Version3ClientSurface;
}

/**
 * Create a production Jira client backed by the maintained `jira.js` SDK
 * (Version3Client). Keeps the existing JiraClient interface so callers and
 * tests do not need to change.
 */
export function createRealJiraClient(
  config: JiraAdapterConfig,
  overrides?: RealJiraClientOverrides
): JiraClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl || '');
  const email = config.email?.trim() || '';
  const apiToken = config.apiToken?.trim() || '';

  if (!overrides?.client && (!baseUrl || !email || !apiToken)) {
    throw new Error(
      'Jira adapter: mockMode is false but baseUrl, email, or apiToken is missing. Set them in config or via JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.'
    );
  }

  const client: Version3ClientSurface =
    overrides?.client ??
    new Version3Client({
      host: baseUrl,
      authentication: {
        basic: { email, apiToken },
      },
    });

  return {
    async addComment(issueKey, commentText): Promise<{ success: boolean; issueKey: string }> {
      try {
        await client.issueComments.addComment({
          issueIdOrKey: issueKey,
          comment: markdownToAdfDoc(commentText),
        });
        return { success: true, issueKey };
      } catch (err) {
        throw wrapJiraError('addComment', err);
      }
    },

    async getIssue(issueKey): Promise<JiraIssueRecord | null> {
      try {
        const data = await client.issues.getIssue({ issueIdOrKey: issueKey });
        return {
          key: data.key ?? issueKey,
          fields: (data.fields ?? {}) as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (isHttpStatus(err, 404)) return null;
        throw wrapJiraError('getIssue', err);
      }
    },

    async updateIssue(issueKey, updates): Promise<{ success: boolean }> {
      try {
        await client.issues.editIssue({
          issueIdOrKey: issueKey,
          fields: updates,
        });
        return { success: true };
      } catch (err) {
        throw wrapJiraError('updateIssue', err);
      }
    },

    async getComments(issueKey): Promise<JiraCommentRecord[]> {
      try {
        const page = await client.issueComments.getComments({ issueIdOrKey: issueKey });
        const list = page.comments ?? [];
        return list.map((c) => ({
          text:
            typeof c.renderedBody === 'string' && c.renderedBody
              ? c.renderedBody
              : c.body
                ? JSON.stringify(c.body)
                : '',
          createdAt: c.created || new Date().toISOString(),
        }));
      } catch (err) {
        throw wrapJiraError('getComments', err);
      }
    },

    clear(): void {
      /* no-op for REST client */
    },
  };
}

function isHttpStatus(err: unknown, status: number): boolean {
  return err instanceof HttpException && err.status === status;
}

function wrapJiraError(op: string, err: unknown): Error {
  if (err instanceof HttpException) {
    const body =
      typeof err.response === 'string'
        ? err.response
        : JSON.stringify(err.response).slice(0, 500);
    return new Error(`Jira ${op} failed: ${err.status} ${err.statusText ?? ''} ${body}`.trim());
  }
  if (err instanceof Error) return err;
  return new Error(`Jira ${op} failed: ${String(err)}`);
}
