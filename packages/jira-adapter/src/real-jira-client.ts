import { Version3Client } from 'jira.js';
import { HttpException } from 'jira.js';
import type { Logger } from '@agent-detective/types';
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
  /**
   * Optional logger. When present, the client surfaces structured diagnostics
   * on `addComment` failures (ADF validation errors in particular, which Jira
   * returns as an opaque `INVALID_INPUT` that is hard to diagnose from the
   * bare error message alone).
   */
  logger?: Logger;
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

  const logger = overrides?.logger;

  return {
    async addComment(issueKey, commentText): Promise<{ success: boolean; issueKey: string }> {
      const adf = markdownToAdfDoc(commentText);
      try {
        await client.issueComments.addComment({
          issueIdOrKey: issueKey,
          comment: adf,
        });
        return { success: true, issueKey };
      } catch (err) {
        // Jira's ADF validator returns a generic `INVALID_INPUT` for every
        // structural issue, which makes isolated `400 Bad Request` failures
        // common when the agent's Markdown hits an edge case the
        // Markdown→ADF converter hasn't hardened against yet. Rather than
        // lose the analysis comment, retry once with a plain-text ADF doc
        // (which is a very small surface Jira will almost always accept)
        // and surface enough telemetry to diagnose the original rejection.
        if (isInvalidAdfCommentError(err)) {
          logger?.warn(
            `Jira rejected ADF comment for ${issueKey} (INVALID_INPUT). Retrying as plain text. ` +
              `adfSummary=${summarizeAdf(adf)} originalError=${describeHttpError(err)}`
          );
          try {
            await client.issueComments.addComment({
              issueIdOrKey: issueKey,
              comment: plainTextToAdfDoc(commentText),
            });
            logger?.info(
              `Jira plain-text retry succeeded for ${issueKey} (formatting lost but body preserved).`
            );
            return { success: true, issueKey };
          } catch (retryErr) {
            logger?.error(
              `Jira plain-text retry also failed for ${issueKey}: ${describeHttpError(retryErr)}`
            );
            throw wrapJiraError('addComment', retryErr);
          }
        }
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
          author: c.author
            ? {
                accountId: c.author.accountId,
                emailAddress: c.author.emailAddress,
                displayName: c.author.displayName,
              }
            : undefined,
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

/**
 * True when Jira has rejected our comment body for ADF-validation reasons.
 * The canonical shape is `400 Bad Request` with a response body of
 * `{ errorMessages: ['INVALID_INPUT'], errors: { comment: 'INVALID_INPUT' } }`.
 * Matching on the loose `INVALID_INPUT` substring is deliberate so the
 * check still fires if Jira expands its error model.
 */
function isInvalidAdfCommentError(err: unknown): boolean {
  if (!(err instanceof HttpException) || err.status !== 400) return false;
  const resp = err.response;
  if (!resp) return false;
  if (typeof resp === 'string') return resp.includes('INVALID_INPUT');
  try {
    return JSON.stringify(resp).includes('INVALID_INPUT');
  } catch {
    return false;
  }
}

function describeHttpError(err: unknown): string {
  if (err instanceof HttpException) {
    const body =
      typeof err.response === 'string'
        ? err.response
        : JSON.stringify(err.response ?? {}).slice(0, 300);
    return `${err.status} ${err.statusText ?? ''} ${body}`.trim();
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Build a shape-only summary of an ADF document (no user text) suitable for
 * logging. The goal is to help us track down which structural pattern is
 * tripping Jira's validator without spilling issue content into logs.
 */
function summarizeAdf(doc: AdfDoc): string {
  const counts = new Map<string, number>();
  const visit = (nodes: unknown[]): void => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as { type?: unknown; content?: unknown; marks?: unknown };
      if (typeof n.type === 'string') {
        counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
      }
      if (Array.isArray(n.content)) visit(n.content);
      if (Array.isArray(n.marks)) {
        for (const mark of n.marks) {
          if (mark && typeof mark === 'object' && typeof (mark as { type?: unknown }).type === 'string') {
            const key = `mark:${(mark as { type: string }).type}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
      }
    }
  };
  visit(doc.content);
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`);
  return `{blocks=${doc.content.length}, ${parts.join(', ')}}`;
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
