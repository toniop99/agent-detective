import { Version3Client } from 'jira.js';
import { HttpException } from 'jira.js';
import type { Logger } from '@agent-detective/sdk';
import type { JiraAdapterConfig } from '../domain/types.js';
import type {
  JiraClient,
  JiraAttachmentRecord,
  JiraCommentRecord,
  JiraIssueRecord,
  JiraSubtaskCreateSpec,
} from './jira-client.js';
import { markdownToAdfDoc, type AdfDoc } from './markdown-to-adf.js';
import { extractBodyText } from '../domain/comment-trigger.js';
import { exchangeJiraRefreshToken } from './jira-oauth.js';
import type { JiraStartupAuth } from './resolve-jira-startup-auth.js';

function normalizeBaseUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

/** Minimal jira.js Version3Client surface used by this adapter. Enables test stubs. */
export type Version3ClientSurface = Pick<Version3Client, 'issues' | 'issueComments' | 'issueAttachments'>;

/**
 * Convert a plain-text (or single-paragraph) string into an ADF doc.
 * New code should prefer {@link markdownToAdfDoc}.
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
  const logger = overrides?.logger;

  const PROACTIVE_REFRESH_BUFFER_MS = 60_000;
  let auth: JiraStartupAuth | null = null;
  let oauthRefreshChain: Promise<void> = Promise.resolve();

  const buildClientFromAuth = (a: JiraStartupAuth): Version3ClientSurface => {
    if (a.mode === 'basic') {
      return new Version3Client({
        host: normalizeBaseUrl(a.baseUrl),
        authentication: {
          basic: { email: a.email, apiToken: a.apiToken },
        },
      });
    }
    // OAuth calls must be routed via api.atlassian.com with cloudId in the path.
    return new Version3Client({
      host: `https://api.atlassian.com/ex/jira/${a.cloudId}`,
      authentication: {
        oauth2: { accessToken: a.accessToken },
      },
    });
  };

  const refreshOAuthAccessToken = async (reason: string): Promise<void> => {
    if (!auth || auth.mode !== 'oauth') return;
    const o = auth;
    logger?.info(`jira-adapter: refreshing OAuth access token (${reason})`);
    const tokens = await exchangeJiraRefreshToken({
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      refreshToken: o.refreshToken,
    });
    let refreshToken = o.refreshToken;
    if (tokens.refresh_token) {
      refreshToken = tokens.refresh_token;
      logger?.warn(
        'jira-adapter: OAuth refresh returned a new refresh_token — update JIRA_OAUTH_REFRESH_TOKEN (or plugin config)'
      );
    }
    let expiresAtMs = o.expiresAtMs;
    if (typeof tokens.expires_in === 'number') {
      expiresAtMs = Date.now() + tokens.expires_in * 1000;
    }
    auth = {
      mode: 'oauth',
      cloudId: o.cloudId,
      accessToken: tokens.access_token,
      refreshToken,
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      expiresAtMs,
    };
    client = buildClientFromAuth(auth);
  };

  const scheduleOAuthRefresh = (reason: string): Promise<void> => {
    oauthRefreshChain = oauthRefreshChain.then(() => refreshOAuthAccessToken(reason));
    return oauthRefreshChain;
  };

  const ensureOAuthFresh = async (): Promise<void> => {
    if (!auth || auth.mode !== 'oauth') return;
    if (!auth.accessToken) {
      await scheduleOAuthRefresh('startup (no access token)');
      return;
    }
    const exp = auth.expiresAtMs;
    if (exp !== undefined && Date.now() > exp - PROACTIVE_REFRESH_BUFFER_MS) {
      await scheduleOAuthRefresh('proactive (near expiry)');
    }
  };

  const isAuthFailure = (err: unknown): boolean => {
    return err instanceof HttpException && (err.status === 401 || err.status === 403);
  };

  const withRetry = async <T>(op: string, fn: (c: Version3ClientSurface) => Promise<T>): Promise<T> => {
    await ensureOAuthFresh();
    try {
      return await fn(client);
    } catch (err) {
      if (auth?.mode === 'oauth' && isAuthFailure(err)) {
        logger?.warn(`jira-adapter: Jira auth error during ${op} — attempting token refresh`);
        await scheduleOAuthRefresh('reactive (401)');
        return await fn(client);
      }
      throw err;
    }
  };

  let client: Version3ClientSurface =
    overrides?.client ??
    (() => {
      const hasOAuthBundle = Boolean(
        config.oauthClientId?.trim() &&
          config.oauthClientSecret?.trim() &&
          config.oauthRefreshToken?.trim()
      );
      if (hasOAuthBundle) {
        const cloudId = config.cloudId?.trim() ?? '';
        if (!cloudId) {
          throw new Error('jira-adapter: OAuth configured but cloudId is missing (set JIRA_CLOUD_ID).');
        }
        auth = {
          mode: 'oauth',
          cloudId,
          clientId: config.oauthClientId!.trim(),
          clientSecret: config.oauthClientSecret!.trim(),
          refreshToken: config.oauthRefreshToken!.trim(),
          accessToken: config.apiToken?.trim() ?? '',
          expiresAtMs: undefined,
        };
        return buildClientFromAuth(auth);
      }

      const baseUrl = normalizeBaseUrl(config.baseUrl || '');
      const email = config.email?.trim() || '';
      const apiToken = config.apiToken?.trim() || '';
      if (!baseUrl || !email || !apiToken) {
        throw new Error(
          'Jira adapter: mockMode is false but baseUrl, email, or apiToken is missing (Basic auth). ' +
            'Configure Basic auth (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN) or OAuth (JIRA_OAUTH_CLIENT_ID, JIRA_OAUTH_CLIENT_SECRET, JIRA_OAUTH_REFRESH_TOKEN, JIRA_CLOUD_ID).'
        );
      }
      auth = { mode: 'basic', baseUrl, email, apiToken };
      return buildClientFromAuth(auth);
    })();

  return {
    async addComment(issueKey, commentText, options?): Promise<{ success: boolean; issueKey: string }> {
      const adf = markdownToAdfDoc(commentText);
      try {
        await withRetry('addComment', (c) =>
          c.issueComments.addComment({
            issueIdOrKey: issueKey,
            comment: adf,
            ...(options?.parentId ? { parentId: options.parentId } : {}),
          })
        );
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
            await withRetry('addCommentPlainTextRetry', (c) =>
              c.issueComments.addComment({
                issueIdOrKey: issueKey,
                comment: plainTextToAdfDoc(commentText),
                ...(options?.parentId ? { parentId: options.parentId } : {}),
              })
            );
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
        const data = await withRetry('getIssue', (c) => c.issues.getIssue({ issueIdOrKey: issueKey }));
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
        await withRetry('updateIssue', (c) =>
          c.issues.editIssue({
          issueIdOrKey: issueKey,
          fields: updates,
          })
        );
        return { success: true };
      } catch (err) {
        throw wrapJiraError('updateIssue', err);
      }
    },

    async getComments(issueKey): Promise<JiraCommentRecord[]> {
      try {
        const page = await withRetry('getComments', (c) =>
          c.issueComments.getComments({
            issueIdOrKey: issueKey,
            expand: 'renderedBody',
          })
        );
        const list = page.comments ?? [];
        return list.map((c) => ({
          text:
            typeof c.renderedBody === 'string' && c.renderedBody
              ? c.renderedBody
              : extractBodyText(c.body) ?? '',
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

    async getAttachments(issueKey): Promise<JiraAttachmentRecord[]> {
      try {
        const data = await withRetry('getAttachments', (c) =>
          c.issues.getIssue({
            issueIdOrKey: issueKey,
            fields: ['attachment'],
          })
        );
        const attachments = (data.fields?.attachment ?? []) as unknown as Array<Record<string, unknown>>;
        return attachments
          .filter((a) => typeof a.mimeType === 'string' && a.mimeType.startsWith('image/'))
          .map((a) => ({
            id: String(a.id ?? ''),
            filename: String(a.filename ?? 'attachment'),
            mimeType: String(a.mimeType ?? 'image/jpeg'),
            size: typeof a.size === 'number' ? a.size : 0,
          }))
          .filter((a) => a.id);
      } catch (err) {
        if (isHttpStatus(err, 404)) return [];
        throw wrapJiraError('getAttachments', err);
      }
    },

    async downloadAttachment(attachmentId): Promise<Buffer> {
      try {
        return (await withRetry('downloadAttachment', (c) =>
          c.issueAttachments.getAttachmentContent(attachmentId) as Promise<Buffer>
        )) as Buffer;
      } catch (err) {
        throw wrapJiraError('downloadAttachment', err);
      }
    },

    async createSubtasks(
      parentIssueKey: string,
      specs: ReadonlyArray<JiraSubtaskCreateSpec>
    ): Promise<{ keys: string[] }> {
      if (specs.length === 0) return { keys: [] };
      let parentFields: Record<string, unknown>;
      try {
        const data = await withRetry('getIssueForSubtasks', (c) =>
          c.issues.getIssue({ issueIdOrKey: parentIssueKey })
        );
        parentFields = (data.fields ?? {}) as Record<string, unknown>;
      } catch (err) {
        if (isHttpStatus(err, 404)) {
          throw new Error(`jira-adapter: parent issue ${parentIssueKey} not found for createSubtasks`, {
            cause: err,
          });
        }
        throw wrapJiraError('getIssue', err);
      }
      const project = parentFields.project;
      const projectKey =
        typeof project === 'object' &&
        project !== null &&
        'key' in project &&
        typeof (project as { key?: unknown }).key === 'string'
          ? (project as { key: string }).key
          : undefined;
      if (!projectKey) {
        throw new Error(`jira-adapter: could not resolve project key for parent ${parentIssueKey}`);
      }
      const keys: string[] = [];
      for (const spec of specs) {
        const created = await withRetry('createSubtask', (c) =>
          c.issues.createIssue({
            fields: {
              project: { key: projectKey },
              parent: { key: parentIssueKey },
              summary: spec.summary,
              ...(spec.description ? { description: markdownToAdfDoc(spec.description) } : {}),
              issuetype: { name: 'Sub-task' },
            },
          })
        );
        const key = (created as { key?: string }).key;
        if (!key) {
          throw new Error('jira-adapter: createIssue returned no key');
        }
        keys.push(key);
      }
      return { keys };
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
