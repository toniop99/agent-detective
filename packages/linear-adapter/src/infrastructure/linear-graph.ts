import { LinearClient, AuthenticationLinearError, LinearError, LinearErrorType } from '@linear/sdk';
import type { Logger } from '@agent-detective/sdk';
import type { LinearTaskInfo } from '../domain/types.js';
import { stampComment } from '../domain/comment-mark.js';
import { exchangeLinearRefreshToken } from './linear-oauth.js';
import type { LinearGraphAuth } from './resolve-linear-startup-auth.js';

export interface LinearIssueCommentRow {
  id: string;
  text: string;
  createdAt: string;
  /** `user:` + userId, `bot:` + bot id, or `unknown`. */
  actorKey: string;
}

export interface LinearGraph {
  addIssueComment(issueId: string, body: string, opts?: { parentId?: string }): Promise<void>;
  fetchIssue(issueId: string): Promise<LinearTaskInfo>;
  listCommentsForPr(issueId: string): Promise<LinearIssueCommentRow[]>;
  listImageAttachments(issueId: string): Promise<Array<{ id: string; filename: string; mimeType: string; size: number }>>;
  downloadAttachment(attachmentId: string): Promise<Buffer>;
}

function formatLinearDateTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : String(value);
}

function guessMimeFromUrl(url: string): string | null {
  const u = url.toLowerCase().split('?')[0] ?? '';
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
  if (u.endsWith('.gif')) return 'image/gif';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

function makeClient(auth: LinearGraphAuth): LinearClient {
  return auth.mode === 'pat'
    ? new LinearClient({ apiKey: auth.token })
    : new LinearClient({ accessToken: auth.accessToken });
}

function isLinearAuthFailure(err: unknown): boolean {
  if (err instanceof AuthenticationLinearError) return true;
  if (err instanceof LinearError && err.type === LinearErrorType.AuthenticationError) return true;
  return false;
}

const PROACTIVE_REFRESH_BUFFER_MS = 60_000;

export function createLinearGraph(deps: {
  auth: LinearGraphAuth;
  mockComments: boolean;
  logger?: Logger;
  /**
   * Only for OAuth `actor=app` tokens: optional `createAsUser` / `displayIconUrl` on `commentCreate`
   * (@see https://linear.app/developers/oauth-actor-authorization). Ignored for PAT auth.
   */
  oauthAppCommentBranding?: { createAsUser: string; displayIconUrl?: string };
}): LinearGraph {
  let auth: LinearGraphAuth = deps.auth;
  let client: LinearClient = makeClient(auth);

  let oauthRefreshChain: Promise<void> = Promise.resolve();

  async function refreshOAuthAccessToken(reason: string): Promise<void> {
    if (auth.mode !== 'oauth') return;
    const o = auth;
    deps.logger?.info(`linear-adapter: refreshing OAuth access token (${reason})`);
    const tokens = await exchangeLinearRefreshToken({
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      refreshToken: o.refreshToken,
    });
    let refreshToken = o.refreshToken;
    if (tokens.refresh_token) {
      refreshToken = tokens.refresh_token;
      deps.logger?.warn(
        'linear-adapter: OAuth refresh returned a new refresh_token — update LINEAR_OAUTH_REFRESH_TOKEN (or plugin config)'
      );
    }
    let expiresAtMs = o.expiresAtMs;
    if (typeof tokens.expires_in === 'number') {
      expiresAtMs = Date.now() + tokens.expires_in * 1000;
    }
    auth = {
      mode: 'oauth',
      accessToken: tokens.access_token,
      refreshToken,
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      expiresAtMs,
    };
    client = makeClient(auth);
  }

  function scheduleOAuthRefresh(reason: string): Promise<void> {
    oauthRefreshChain = oauthRefreshChain.then(() => refreshOAuthAccessToken(reason));
    return oauthRefreshChain;
  }

  async function ensureOAuthFresh(): Promise<void> {
    if (auth.mode !== 'oauth') return;
    const exp = auth.expiresAtMs;
    if (exp !== undefined && Date.now() > exp - PROACTIVE_REFRESH_BUFFER_MS) {
      await scheduleOAuthRefresh('proactive (near expiry)');
    }
  }

  async function withRetry<T>(op: string, fn: (c: LinearClient) => Promise<T>): Promise<T> {
    await ensureOAuthFresh();
    try {
      return await fn(client);
    } catch (err) {
      if (auth.mode === 'oauth' && isLinearAuthFailure(err)) {
        deps.logger?.warn(`linear-adapter: Linear auth error during ${op} — attempting token refresh`);
        await scheduleOAuthRefresh('reactive (401)');
        return await fn(client);
      }
      throw err;
    }
  }

  return {
    async addIssueComment(issueId, body, opts) {
      const stamped = stampComment(body);
      if (deps.mockComments) {
        deps.logger?.info(
          `[MOCK Linear] comment issue=${issueId} parent=${opts?.parentId ?? '(root)'} len=${stamped.length}`
        );
        return;
      }
      await withRetry('addIssueComment', (c) =>
        c.createComment({
          issueId,
          body: stamped,
          ...(opts?.parentId ? { parentId: opts.parentId } : {}),
          ...(auth.mode === 'oauth' && deps.oauthAppCommentBranding
            ? {
                createAsUser: deps.oauthAppCommentBranding.createAsUser,
                ...(deps.oauthAppCommentBranding.displayIconUrl
                  ? { displayIconUrl: deps.oauthAppCommentBranding.displayIconUrl }
                  : {}),
              }
            : {}),
        })
      );
    },
    async fetchIssue(issueId) {
      return withRetry('fetchIssue', async (c) => {
        const issue = await c.issue(issueId);
        const labelConn = await issue.labels({ first: 100 });
        const nodes = labelConn.nodes ?? [];
        const labels = nodes.map((n) => n.name).filter((n): n is string => Boolean(n));
        const ident = issue.identifier ?? issueId;
        const projectKey = ident.includes('-') ? ident.split('-')[0]! : 'LINEAR';
        return {
          issueUuid: issue.id,
          key: ident,
          summary: issue.title,
          description: issue.description ?? '',
          projectKey,
          labels,
        };
      });
    },
    async listCommentsForPr(issueId) {
      return withRetry('listCommentsForPr', async (c) => {
        const issue = await c.issue(issueId);
        const conn = await issue.comments({ first: 100 });
        const rows: LinearIssueCommentRow[] = [];
        for (const com of conn.nodes ?? []) {
          const uid = com.userId;
          const botId = com.botActor?.id;
          const actorKey = uid ? `user:${uid}` : botId ? `bot:${botId}` : 'unknown';
          rows.push({
            id: com.id,
            text: com.body ?? '',
            createdAt: formatLinearDateTime(com.createdAt),
            actorKey,
          });
        }
        return rows;
      });
    },
    async listImageAttachments(issueId) {
      return withRetry('listImageAttachments', async (c) => {
        const issue = await c.issue(issueId);
        const conn = await issue.attachments({ first: 50 });
        const out: Array<{ id: string; filename: string; mimeType: string; size: number }> = [];
        for (const a of conn.nodes ?? []) {
          const url = typeof a.url === 'string' ? a.url : '';
          const mime = guessMimeFromUrl(url);
          if (!mime || !mime.startsWith('image/')) continue;
          out.push({
            id: a.id,
            filename: a.title || 'attachment',
            mimeType: mime,
            size: 0,
          });
        }
        return out;
      });
    },
    async downloadAttachment(attachmentId) {
      const buf = await withRetry('downloadAttachment', async (c) => {
        const a = await c.attachment(attachmentId);
        const url = typeof a.url === 'string' ? a.url : '';
        if (!url) {
          throw new Error('linear-adapter: attachment has no downloadable URL');
        }
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) {
          throw new Error(`linear-adapter: failed to download attachment (${res.status})`);
        }
        return Buffer.from(await res.arrayBuffer());
      });
      return buf;
    },
  };
}
