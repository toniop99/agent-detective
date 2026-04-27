import { LinearClient } from '@linear/sdk';
import type { Logger } from '@agent-detective/sdk';
import type { LinearTaskInfo } from '../domain/types.js';
import { stampComment } from '../domain/comment-mark.js';

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

export function createLinearGraph(deps: {
  apiKey: string;
  mockComments: boolean;
  logger?: Logger;
}): LinearGraph {
  const client = new LinearClient({ apiKey: deps.apiKey.trim() });
  return {
    async addIssueComment(issueId, body, opts) {
      const stamped = stampComment(body);
      if (deps.mockComments) {
        deps.logger?.info(
          `[MOCK Linear] comment issue=${issueId} parent=${opts?.parentId ?? '(root)'} len=${stamped.length}`
        );
        return;
      }
      await client.createComment({
        issueId,
        body: stamped,
        ...(opts?.parentId ? { parentId: opts.parentId } : {}),
      });
    },
    async fetchIssue(issueId) {
      const issue = await client.issue(issueId);
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
    },
    async listCommentsForPr(issueId) {
      const issue = await client.issue(issueId);
      const conn = await issue.comments({ first: 100 });
      const rows: LinearIssueCommentRow[] = [];
      for (const c of conn.nodes ?? []) {
        const uid = c.userId;
        const botId = c.botActor?.id;
        const actorKey = uid ? `user:${uid}` : botId ? `bot:${botId}` : 'unknown';
        rows.push({
          id: c.id,
          text: c.body ?? '',
          createdAt: formatLinearDateTime(c.createdAt),
          actorKey,
        });
      }
      return rows;
    },
    async listImageAttachments(issueId) {
      const issue = await client.issue(issueId);
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
    },
    async downloadAttachment(attachmentId) {
      const a = await client.attachment(attachmentId);
      const url = typeof a.url === 'string' ? a.url : '';
      if (!url) {
        throw new Error('linear-adapter: attachment has no downloadable URL');
      }
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`linear-adapter: failed to download attachment (${res.status})`);
      }
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
