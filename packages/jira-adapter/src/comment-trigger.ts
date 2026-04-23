/**
 * Helpers for the comment-triggered retry flow:
 *
 *   - The adapter stamps every comment it posts with `AGENT_DETECTIVE_MARKER`
 *     so it can recognize its own output later (loop protection).
 *   - Incoming `jira:comment_created` payloads are run through `hasTriggerPhrase`
 *     against the configured phrase and `isOwnComment` against both the marker
 *     and the optional `jiraUser` identity.
 *
 * All helpers are pure and stateless — no Jira API calls, no time — so they
 * are easy to unit test and cheap to run on every webhook.
 */

/**
 * Distinctive token the adapter appends (visibly) to every comment it posts.
 * Choice of exotic punctuation (em-dash + middle-dot) + the `ad-v1` suffix
 * makes accidental collisions with human-typed text effectively impossible
 * while still reading as a legitimate "signed by" footer.
 *
 * Crucially, this token is embedded in ordinary Markdown (an `hr` + italic
 * paragraph) so it **survives the Markdown → ADF → webhook-echo round
 * trip**. The previous implementation used an HTML comment marker
 * (`<!-- agent-detective:v1 -->`), but `marked`'s HTML-comment handling is
 * inconsistent across configurations and Jira's ADF pipeline will drop it
 * in some setups — the reminder comment then got treated as a user trigger
 * (because the reminder body itself quotes `#agent-detective analyze` as
 * instructions) and spammed the ticket. See the loop protection notes in
 * `docs/jira-manual-e2e.md`.
 */
export const AGENT_DETECTIVE_MARKER = 'agent-detective · ad-v1';

/**
 * The Markdown footer appended by `stampComment`. Renders as a horizontal
 * rule followed by an italic "— Posted by agent-detective · ad-v1" line,
 * every token of which lives in plain ADF text nodes that are preserved by
 * every downstream renderer.
 */
const MARKER_FOOTER_MARKDOWN = `\n\n---\n_— Posted by ${AGENT_DETECTIVE_MARKER}_`;

/**
 * Legacy HTML-comment marker kept in the recognition list only — `stampComment`
 * no longer emits it. Any comment the adapter posted before this change is
 * still recognized as own-authored on replay.
 */
const LEGACY_HTML_MARKER = '<!-- agent-detective:v1 -->';

/**
 * Returns `body` with a visible marker footer appended. Idempotent: if the
 * body already contains the marker we return it unchanged so repeated
 * stamping on the same string is a no-op.
 */
export function stampComment(body: string): string {
  if (!body) return MARKER_FOOTER_MARKDOWN.trimStart();
  if (body.includes(AGENT_DETECTIVE_MARKER)) return body;
  return `${body}${MARKER_FOOTER_MARKDOWN}`;
}

/**
 * Case-insensitive substring check. We deliberately don't require word
 * boundaries so operators can wrap the phrase in other text
 * (e.g. "hey #agent-detective analyze please — this is urgent"), but a
 * slash/hashtag-prefixed default keeps accidental matches on ordinary
 * English very unlikely.
 */
export function hasTriggerPhrase(body: string, phrase: string): boolean {
  if (!body || !phrase) return false;
  return body.toLowerCase().includes(phrase.toLowerCase());
}

/**
 * Returns the comment body with the first **case-insensitive** occurrence of
 * `triggerPhrase` removed, then internal whitespace collapsed to single spaces.
 * Use to pass free-form operator context after a trigger (e.g. after
 * `#agent-detective pr` with a file name or commit hash).
 * Empty string if the phrase is not found, `body` is empty, or nothing remains.
 */
export function extraTextOutsideTriggerPhrase(body: string, triggerPhrase: string): string {
  if (!body?.trim() || !triggerPhrase) return '';
  const lowerBody = body.toLowerCase();
  const lowerPhrase = triggerPhrase.toLowerCase();
  const idx = lowerBody.indexOf(lowerPhrase);
  if (idx < 0) return '';
  const rest = body.slice(0, idx) + body.slice(idx + triggerPhrase.length);
  return rest.replace(/\s+/g, ' ').trim();
}

export interface CommentAuthor {
  accountId?: string;
  emailAddress?: string;
}

export interface AdapterIdentity {
  accountId?: string;
  email?: string;
}

/**
 * True if this comment was authored by the adapter. Checks the hidden marker
 * first (stateless, works in mockMode), then falls back to the configured
 * `jiraUser` identity (defense in depth against someone stripping the marker
 * when editing a comment, or future marker format changes).
 */
export function isOwnComment(
  body: string | undefined | null,
  author: CommentAuthor | undefined | null,
  ownUser: AdapterIdentity | undefined | null
): boolean {
  if (typeof body === 'string') {
    if (body.includes(AGENT_DETECTIVE_MARKER)) return true;
    // Recognize comments stamped with the pre-v1-footer HTML marker so
    // existing tickets don't loop when the adapter restarts.
    if (body.includes(LEGACY_HTML_MARKER)) return true;
  }
  if (!author || !ownUser) return false;
  if (ownUser.accountId && author.accountId && ownUser.accountId === author.accountId) {
    return true;
  }
  if (
    ownUser.email &&
    author.emailAddress &&
    ownUser.email.toLowerCase() === author.emailAddress.toLowerCase()
  ) {
    return true;
  }
  return false;
}

export interface ExtractedComment {
  id?: string;
  body: string;
  author?: CommentAuthor;
}

/**
 * Pulls the comment body + author out of a raw webhook payload. Handles:
 *
 *   - native Jira `jira:comment_created` envelopes (`{ comment: { body, author }, issue, … }`)
 *   - Automation "Automation format" bare-issue payloads that include
 *     `comment` at the top level next to the flattened issue
 *   - Automation "Custom data" payloads that embed `{ comment: { … } }`
 *     alongside smart-value-expanded fields
 *
 * Returns `null` when no comment-shaped object is present (caller should
 * treat that as "no trigger").
 */
export function extractCommentInfo(rawPayload: unknown): ExtractedComment | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const p = rawPayload as Record<string, unknown>;
  const comment = readCommentObject(p.comment);
  if (comment) return comment;
  // Some Automation rules embed the comment under `issue.fields.comment.comments[0]`
  // when the smart value is `{{issue.comments.last}}`. Best-effort fallback.
  const issue = p.issue as Record<string, unknown> | undefined;
  const fields = issue?.fields as Record<string, unknown> | undefined;
  const fieldComment = fields?.comment as Record<string, unknown> | undefined;
  if (fieldComment) {
    const comments = fieldComment.comments;
    if (Array.isArray(comments) && comments.length > 0) {
      const last = comments[comments.length - 1];
      const extracted = readCommentObject(last);
      if (extracted) return extracted;
    }
  }
  return null;
}

function readCommentObject(value: unknown): ExtractedComment | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  const body = extractBodyText(c.body);
  if (body === null) return null;
  const author = readAuthor(c.author);
  const id =
    typeof c.id === 'string' ? c.id :
    typeof c.id === 'number' ? String(c.id) :
    undefined;
  const result: ExtractedComment = { body };
  if (id) result.id = id;
  if (author) result.author = author;
  return result;
}

function readAuthor(value: unknown): CommentAuthor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const a = value as Record<string, unknown>;
  const accountId = typeof a.accountId === 'string' ? a.accountId : undefined;
  const emailAddress = typeof a.emailAddress === 'string' ? a.emailAddress : undefined;
  if (!accountId && !emailAddress) return undefined;
  return { accountId, emailAddress };
}

/**
 * Comment bodies come in two shapes depending on API version + serializer:
 *   - REST v2 / `renderedFields` / Automation "Jira format" → plain string
 *   - REST v3 → Atlassian Document Format (ADF) object `{ type: 'doc', content: [...] }`
 *
 * For trigger-phrase matching we only need the concatenated text, so we
 * flatten ADF paragraphs into a single string. Non-text ADF nodes (mentions,
 * emoji, etc.) contribute nothing — users have to actually type the phrase.
 */
export function extractBodyText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.type === 'doc' && Array.isArray(v.content)) {
    return flattenAdfNodes(v.content);
  }
  return null;
}

function flattenAdfNodes(nodes: unknown[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (typeof n.text === 'string') {
      parts.push(n.text);
    }
    if (Array.isArray(n.content)) {
      parts.push(flattenAdfNodes(n.content));
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
