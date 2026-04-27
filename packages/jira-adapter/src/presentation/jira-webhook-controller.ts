import { z } from 'zod';
import {
  defineRoute,
  registerRoutes,
  type RouteDefinition,
  type FastifyScope,
  type FastifyRequest,
  type Logger,
} from '@agent-detective/sdk';
import type { JiraWebhookResponse } from '../domain/webhook-types.js';
import { JiraWebhookPayloadError } from '../application/webhook-handler.js';

type JiraWebhookHandler = ReturnType<typeof import('../application/webhook-handler.js').createJiraWebhookHandler>;

const PLUGIN_TAG = '@agent-detective/jira-adapter';

/**
 * Schema is intentionally permissive: Jira sends multiple shapes (native
 * webhooks, Automation "Jira format", Automation "Automation format"),
 * `resolveWebhookEvent` below disambiguates them and the handler treats
 * unknown payloads as 400. Validating only the loose envelope here keeps
 * the adapter compatible with future Jira shape changes.
 */
const JiraWebhookBody = z
  .object({
    webhookEvent: z.string().optional(),
    issue_event_type_name: z.string().optional(),
    eventTypeName: z.string().optional(),
    timestamp: z.number().optional(),
    issue: z.record(z.string(), z.unknown()).optional(),
    comment: z.record(z.string(), z.unknown()).optional(),
    user: z.record(z.string(), z.unknown()).optional(),
    changelog: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const JiraWebhookQuery = z
  .object({ webhookEvent: z.string().optional() })
  .loose();

const JiraWebhookOk = z
  .object({
    status: z.enum(['success', 'ignored', 'error', 'queued']),
    taskId: z.string().optional(),
    message: z.string().optional(),
  })
  .loose();

const JiraWebhookError = z.object({
  status: z.literal('error'),
  message: z.string(),
});

export interface JiraWebhookRouteDeps {
  webhookHandler: JiraWebhookHandler;
  logger?: Logger;
}

export function buildJiraWebhookRoutes(deps: JiraWebhookRouteDeps): RouteDefinition[] {
  const { webhookHandler, logger } = deps;

  const handle = defineRoute({
    method: 'POST',
    url: '/webhook/jira',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Handle Jira webhook',
      description:
        'Receives and processes Jira webhook events for issue created, updated, or deleted',
      body: JiraWebhookBody,
      querystring: JiraWebhookQuery,
      response: { 200: JiraWebhookOk, 400: JiraWebhookError, 500: JiraWebhookError },
    },
    async handler(req: FastifyRequest, reply): Promise<JiraWebhookResponse> {
      try {
        const resolved = resolveWebhookEvent(req);
        if (resolved.source !== 'body.webhookEvent' || resolved.event !== resolved.rawEvent) {
          const rawSuffix =
            resolved.rawEvent && resolved.rawEvent !== resolved.event
              ? ` (raw="${resolved.rawEvent}")`
              : '';
          const reasonSuffix = resolved.reason ? ` — ${resolved.reason}` : '';
          logger?.info(
            `Resolved webhook event from ${resolved.source}: ${resolved.event}${rawSuffix}${reasonSuffix}`,
          );
        }
        const result = await webhookHandler.handleWebhook(req.body as Record<string, unknown>, resolved.event);
        return result as JiraWebhookResponse;
      } catch (err) {
        if (err instanceof JiraWebhookPayloadError) {
          logger?.warn(
            `Jira webhook rejected (malformed payload): ${err.message} summary=${JSON.stringify(err.summary)}`,
          );
          return reply
            .code(400)
            .send({ status: 'error', message: err.message } as JiraWebhookResponse);
        }
        logger?.error(`Jira webhook error: ${(err as Error).message}`);
        return reply
          .code(500)
          .send({ status: 'error', message: (err as Error).message } as JiraWebhookResponse);
      }
    },
  });

  return [handle];
}

export function registerJiraWebhookRoutes(app: FastifyScope, deps: JiraWebhookRouteDeps): void {
  registerRoutes(app, buildJiraWebhookRoutes(deps));
}

export type WebhookEventSource =
  | 'body.webhookEvent'
  | 'body.issue_event_type_name'
  | 'body.eventTypeName'
  | 'query.webhookEvent'
  | 'payload.shape'
  | 'fallback';

export interface ResolvedWebhookEvent {
  /** Canonical event name (e.g. "jira:issue_created"). */
  event: string;
  /** Verbatim value pulled from the request, before normalization. */
  rawEvent: string;
  /** Which field of the request supplied the event. */
  source: WebhookEventSource;
  /**
   * Human-readable justification for `payload.shape` decisions, used in
   * the info log so operators can see *why* we picked an event when it's
   * not obvious from the payload alone (e.g. "changelog activity
   * (histories[3])").
   */
  reason?: string;
}

/**
 * Maps Jira Automation short names (sent under `issue_event_type_name` when the
 * action body is "Automation format") to the canonical `jira:*` form used by
 * the native Jira webhook system and by our `webhookBehavior.events` config.
 *
 * Automation emits `issue_generic` for most ordinary field changes, so we
 * map it to `jira:issue_updated` to match operator expectations.
 */
const AUTOMATION_EVENT_ALIASES: Record<string, string> = {
  issue_created: 'jira:issue_created',
  issue_updated: 'jira:issue_updated',
  issue_generic: 'jira:issue_updated',
  issue_deleted: 'jira:issue_deleted',
  // Both Jira's short `issue_commented` and the native `comment_created`
  // route to the canonical `jira:comment_created` event — that's the only
  // one `webhookBehavior.events` understands now that comment-triggered
  // retry is the standard flow.
  issue_commented: 'jira:comment_created',
  comment_created: 'jira:comment_created',
  issue_assigned: 'jira:issue_updated',
  issue_resolved: 'jira:issue_updated',
  issue_closed: 'jira:issue_updated',
  issue_reopened: 'jira:issue_updated',
  issue_moved: 'jira:issue_updated',
};

/**
 * Normalizes any supported event value to the canonical `jira:*` form so the
 * same `webhookBehavior.events` config works across every source (native
 * webhook, Automation "Jira format" + URL override, Automation "Automation
 * format"). Unknown values are returned unchanged.
 */
export function normalizeWebhookEventName(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  if (value.startsWith('jira:')) return value;
  const mapped = AUTOMATION_EVENT_ALIASES[value];
  if (mapped) return mapped;
  // Fall back to prefixing bare names that already start with `issue_`, so
  // unknown-but-plausible Automation events route through the `jira:` tree.
  if (/^issue_/.test(value)) return `jira:${value}`;
  return value;
}

/**
 * True if the given object has any sign of issue-changelog activity —
 * enough to treat the event as an `issue_updated` rather than an
 * `issue_created`. Two different payload shapes carry this signal:
 *
 *   - Native Jira webhooks (`jira:issue_updated`) put the delta at the
 *     top level: `{ changelog: { items: [{ field, ... }] } }`.
 *   - Jira Automation's "Automation format" expands `{{issue}}` directly,
 *     which embeds the issue's REST `changelog` page —
 *     `{ changelog: { histories: [{ id, items: [...] }], total, ... } }`.
 *     On a brand-new issue `histories` is empty and `total` is 0, so we
 *     only flag updates when at least one history entry exists.
 *
 * Returning both the boolean and the signal name lets callers surface
 * *why* the classifier picked `issue_updated`, which is otherwise very
 * hard to debug from the payload alone.
 */
function detectChangelogActivity(changelog: unknown): { active: boolean; signal?: string } {
  if (!changelog || typeof changelog !== 'object') return { active: false };
  const c = changelog as Record<string, unknown>;
  if (Array.isArray(c.items) && (c.items as unknown[]).length > 0) {
    return { active: true, signal: `items[${(c.items as unknown[]).length}]` };
  }
  if (Array.isArray(c.histories) && (c.histories as unknown[]).length > 0) {
    return { active: true, signal: `histories[${(c.histories as unknown[]).length}]` };
  }
  if (typeof c.total === 'number' && c.total > 0) {
    return { active: true, signal: `total=${c.total}` };
  }
  return { active: false };
}

/**
 * True when the REST issue payload embeds at least one comment under
 * `fields.comment.comments` — typical when Automation sends "Automation
 * format" `{{issue}}` after a comment was added. Top-level `comment` is
 * handled separately; this covers the common case where only the expanded
 * issue object is POSTed (no `webhookEvent`, no top-level `comment`).
 */
function hasNonEmptyIssueFieldsComments(body: Record<string, unknown>): boolean {
  const issue =
    body.issue && typeof body.issue === 'object' ? (body.issue as Record<string, unknown>) : null;
  const fieldsFromIssue =
    issue?.fields && typeof issue.fields === 'object'
      ? (issue.fields as Record<string, unknown>)
      : null;
  const fieldsFromBare =
    typeof body.key === 'string' && body.fields && typeof body.fields === 'object'
      ? (body.fields as Record<string, unknown>)
      : null;
  const fields = fieldsFromIssue ?? fieldsFromBare;
  if (!fields) return false;
  const fc = fields.comment;
  if (!fc || typeof fc !== 'object') return false;
  const comments = (fc as Record<string, unknown>).comments;
  return Array.isArray(comments) && comments.length > 0;
}

/**
 * Last-resort inference from the payload shape itself, used when none of the
 * explicit event sources (body.webhookEvent, issue_event_type_name,
 * eventTypeName, query.webhookEvent) is populated. This is the common case
 * for Jira Automation's "Send web request" action in "Automation format"
 * when the user didn't add `?webhookEvent=…` to the URL.
 *
 * Heuristics (only when the payload clearly represents an issue event):
 *   - a `comment` object is present                       → `jira:comment_created`
 *   - `changelog` shows activity (items / histories / total) → `jira:issue_updated`
 *   - `issue.fields.comment.comments` is non-empty (bare or envelope issue) →
 *     `jira:comment_created` (Automation `{{issue}}` after a comment)
 *   - otherwise, but the payload looks like an issue       → `jira:issue_created`
 *
 * `comment` wins over `changelog` because Jira Automation comment-event
 * rules always carry `{{issue.comments.last}}` (or similar) alongside the
 * issue, and the presence of a comment is a stronger signal than an
 * incidental label-change changelog attached to the same event.
 *
 * Correctly recognizing the `histories` / `total` variants is what
 * prevents the "adapter posts a comment → Automation fires its update
 * rule → we treat the echoed bare-issue payload as `issue_created` →
 * we analyze again → loop" failure mode. An issue that has been
 * updated at least once always has a non-empty `changelog.histories`
 * when Automation serializes `{{issue}}`.
 *
 * Returns `null` when the payload isn't recognizable as any issue-shaped
 * event, so the caller can keep falling through to the final `unknown`
 * fallback. Also returns a `reason` string on hit so the caller can log
 * why it chose what it chose.
 */
function inferEventFromPayloadShape(
  body: Record<string, unknown>,
): { event: string; reason: string } | null {
  const hasComment = !!body.comment && typeof body.comment === 'object';
  const changelogActivity = detectChangelogActivity(body.changelog);

  const isEnvelope = !!body.issue && typeof body.issue === 'object';
  const isBareIssue =
    typeof body.key === 'string' && !!body.fields && typeof body.fields === 'object';

  if (!isEnvelope && !isBareIssue && !hasComment) return null;
  if (hasComment) {
    return { event: 'jira:comment_created', reason: 'comment object present' };
  }
  if (changelogActivity.active) {
    return {
      event: 'jira:issue_updated',
      reason: `changelog activity (${changelogActivity.signal})`,
    };
  }
  if (hasNonEmptyIssueFieldsComments(body)) {
    return {
      event: 'jira:comment_created',
      reason: 'issue.fields.comment.comments non-empty (Automation bare-issue)',
    };
  }
  return { event: 'jira:issue_created', reason: 'issue shape, no changelog activity' };
}

/**
 * The classic Jira Cloud webhook (System → WebHooks) sends `webhookEvent` in
 * the request body. Automation for Jira's "Send web request" action sends
 * either "Jira format" (no event in body — event must come from the URL) or
 * "Automation format" (event in `issue_event_type_name`). We accept all of
 * these so the same config works for every source.
 *
 * Precedence (most specific → least specific):
 *   1. body.webhookEvent          (native Jira webhooks)
 *   2. body.issue_event_type_name (Automation "Automation format")
 *   3. body.eventTypeName         (alt casing sometimes used in templates)
 *   4. query.webhookEvent         (URL override, e.g. `?webhookEvent=jira:issue_created`)
 *   5. payload.shape              (inferred from `changelog` presence — best-effort
 *                                  safety net for misconfigured Automation rules)
 *   6. 'unknown'                  (router falls back to `webhookBehavior.defaults`)
 *
 * Whatever value wins is then passed through `normalizeWebhookEventName` so
 * downstream routing always sees a canonical `jira:*` name.
 */
export function resolveWebhookEvent(req: FastifyRequest): ResolvedWebhookEvent {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;

  const pick = (raw: string, source: WebhookEventSource): ResolvedWebhookEvent => ({
    rawEvent: raw,
    event: normalizeWebhookEventName(raw),
    source,
  });

  const bodyEvent = typeof body.webhookEvent === 'string' ? body.webhookEvent : undefined;
  if (bodyEvent) return pick(bodyEvent, 'body.webhookEvent');

  const issueEventType =
    typeof body.issue_event_type_name === 'string' ? body.issue_event_type_name : undefined;
  if (issueEventType) return pick(issueEventType, 'body.issue_event_type_name');

  const eventTypeName =
    typeof body.eventTypeName === 'string' ? body.eventTypeName : undefined;
  if (eventTypeName) return pick(eventTypeName, 'body.eventTypeName');

  const queryEvent = typeof query.webhookEvent === 'string' ? query.webhookEvent : undefined;
  if (queryEvent) return pick(queryEvent, 'query.webhookEvent');

  const inferred = inferEventFromPayloadShape(body);
  if (inferred) {
    return { ...pick(inferred.event, 'payload.shape'), reason: inferred.reason };
  }

  return { event: 'unknown', rawEvent: '', source: 'fallback' };
}
