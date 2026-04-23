import { z } from 'zod';
import { normalizeJiraPayload } from './normalizer.js';
import type { JiraTaskInfo, JiraPayload } from './types.js';
import { routeToHandler, HandlerContext } from './handlers/index.js';

/**
 * Describes which shape the incoming webhook payload had before any
 * normalization we performed.
 *   - 'envelope':   `{ issue, user, timestamp }` (native Jira webhooks,
 *                   Automation "Jira format")
 *   - 'bare-issue': the issue object directly at the top level, with keys
 *                   like `{ self, id, key, fields, ... }` — this is what
 *                   Automation's "Automation format" default body template
 *                   emits, since it expands `{{issue}}` without a wrapper.
 *   - 'unknown':    neither shape recognized; passed through untouched.
 */
export type WebhookPayloadShape = 'envelope' | 'bare-issue' | 'unknown';

function detectPayloadShape(payload: Record<string, unknown>): WebhookPayloadShape {
  if (payload.issue && typeof payload.issue === 'object') return 'envelope';
  // Automation format expands `{{issue}}` at the top level, so it looks like
  // a REST issue resource: identifying markers are `key` + `fields` (with
  // `self`/`id` usually present too). Using `key`+`fields` avoids false
  // positives on other payload shapes that happen to contain an `id`.
  if (
    typeof payload.key === 'string' &&
    payload.fields &&
    typeof payload.fields === 'object'
  ) {
    return 'bare-issue';
  }
  return 'unknown';
}

/**
 * Returns a payload in canonical envelope form (`{ issue, user, timestamp }`).
 * For the "bare-issue" shape we wrap the incoming object under `issue` so the
 * Zod schema, normalizer, and handlers can share one code path.
 */
export function normalizeWebhookShape(payload: unknown): {
  payload: unknown;
  shape: WebhookPayloadShape;
} {
  if (!payload || typeof payload !== 'object') {
    return { payload, shape: 'unknown' };
  }
  const p = payload as Record<string, unknown>;
  const shape = detectPayloadShape(p);
  if (shape === 'bare-issue') {
    return {
      payload: { issue: p },
      shape,
    };
  }
  return { payload: p, shape };
}

/**
 * Produces a compact, audit-friendly summary of the parts of a Jira webhook
 * envelope we actually rely on. Used to sanity-check that real Jira /
 * Automation-for-Jira payloads line up with `webhookEnvelopeSchema` — if a
 * field changes type upstream (as happened with `issue.id`), this summary
 * makes it obvious before we dig into stack traces.
 *
 * Accepts both the raw payload (pre-normalization) and, optionally, the
 * detected shape so the log trail records what we actually received on the
 * wire rather than the re-wrapped form.
 */
export function summarizeWebhookPayload(
  payload: unknown,
  shape?: WebhookPayloadShape
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return { kind: typeof payload };
  }
  const p = payload as Record<string, unknown>;
  const detectedShape = shape ?? detectPayloadShape(p);
  const issue =
    detectedShape === 'bare-issue'
      ? p
      : ((p.issue ?? null) as Record<string, unknown> | null);
  const fields = (issue?.fields ?? null) as Record<string, unknown> | null;
  return {
    shape: detectedShape,
    webhookEvent: p.webhookEvent ?? null,
    webhookEventType: typeof p.webhookEvent,
    // Alternate event-identifier keys emitted by Automation for Jira.
    issue_event_type_name: p.issue_event_type_name ?? null,
    eventTypeName: p.eventTypeName ?? null,
    timestampType: typeof p.timestamp,
    issue: issue
      ? {
          idType: typeof issue.id,
          idValue: issue.id ?? null,
          keyType: typeof issue.key,
          key: issue.key ?? null,
          selfType: typeof issue.self,
          fieldKeys: fields ? Object.keys(fields) : [],
        }
      : null,
    hasUser: Boolean(p.user),
    hasChangelog: Boolean(p.changelog),
    changelog: summarizeChangelog(p.changelog),
    hasComment: Boolean(p.comment),
    topLevelKeys: Object.keys(p),
  };
}

/**
 * Surface the bits of a `changelog` object that drive our event
 * classification: the number of `items` (native webhook delta) and
 * `histories` (Automation's `{{issue}}.changelog` page) plus `total`.
 * We intentionally do not include field names here — those can contain
 * user data — but counts are enough to diagnose misclassification.
 */
function summarizeChangelog(changelog: unknown): Record<string, unknown> | null {
  if (!changelog || typeof changelog !== 'object') return null;
  const c = changelog as Record<string, unknown>;
  return {
    itemsLen: Array.isArray(c.items) ? (c.items as unknown[]).length : null,
    historiesLen: Array.isArray(c.histories) ? (c.histories as unknown[]).length : null,
    total: typeof c.total === 'number' ? c.total : null,
  };
}

/**
 * Minimal runtime guard for Jira webhook envelopes. Jira does not commit to a
 * strict schema, so the outer shape is validated loosely — enough to catch
 * totally malformed requests early, while still letting handlers read what
 * real-world events send.
 */
const webhookEnvelopeSchema = z
  .object({
    webhookEvent: z.string().optional(),
    timestamp: z.number().optional(),
    issue: z
      .looseObject({
        // Jira Cloud REST webhooks send id as a string (e.g. "10010"), but
        // Automation-for-Jira emits it as a JSON number. Accept both and
        // normalize to string so downstream code keeps its string assumption
        // (see normalizer.ts and JiraIssue.id in types.ts).
        id: z
          .union([z.string(), z.number()])
          .transform((v) => String(v))
          .optional(),
        key: z.string().optional(),
        self: z.string().optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    user: z.looseObject({}).optional(),
    changelog: z
      .looseObject({
        items: z.array(z.looseObject({})).optional(),
      })
      .optional(),
    // `jira:comment_created` delivers `{ comment, issue, ... }`. The
    // comment body is either a plain string (REST v2 / Automation "Jira
    // format") or an ADF doc (REST v3); both are accepted and flattened
    // in `comment-trigger.ts` before matching.
    comment: z
      .looseObject({
        body: z.union([z.string(), z.looseObject({})]).optional(),
        author: z.looseObject({}).optional(),
      })
      .optional(),
  })
  .loose();

export class JiraWebhookPayloadError extends Error {
  readonly statusCode = 400;
  readonly issues: z.ZodIssue[];
  readonly summary: Record<string, unknown>;
  constructor(issues: z.ZodIssue[], payload: unknown) {
    super(`Invalid Jira webhook payload: ${JSON.stringify(issues).slice(0, 500)}`);
    this.name = 'JiraWebhookPayloadError';
    this.issues = issues;
    this.summary = summarizeWebhookPayload(payload);
  }
}

export function createJiraWebhookHandler(options: HandlerContext) {
  const handlerContext: HandlerContext = options;

  async function handleWebhook(
    payload: unknown,
    webhookEvent: string
  ): Promise<{ status: string; taskId: string }> {
    // Jira Automation's "Automation format" sends a bare issue at the top
    // level instead of `{ issue: {...} }`. Normalize both shapes into the
    // canonical envelope before schema validation so the Zod schema,
    // normalizer, and handlers can share one path.
    const { payload: normalizedPayload, shape } = normalizeWebhookShape(payload);

    const parsed = webhookEnvelopeSchema.safeParse(normalizedPayload);
    if (!parsed.success) {
      throw new JiraWebhookPayloadError(parsed.error.issues, payload);
    }

    const envelope = parsed.data as JiraPayload;

    // One-line audit trail so operators can confirm the real webhook shape
    // matches what our schema declares (event type, id/key types, field keys).
    // handlerContext.logger?.info(
    //   `Webhook payload accepted: ${JSON.stringify(summarizeWebhookPayload(payload, shape))}`
    // );

    const taskEvent = normalizeJiraPayload(envelope);

    const taskInfo = extractTaskInfo(envelope, taskEvent, webhookEvent);

    await routeToHandler(envelope, taskInfo, webhookEvent, handlerContext);

    return { status: 'queued', taskId: taskEvent.id };
  }

  return { handleWebhook };
}

function extractTaskInfo(
  payload: unknown,
  taskEvent: ReturnType<typeof normalizeJiraPayload>,
  _webhookEvent: string
): JiraTaskInfo {
  const p = payload as JiraPayload;
  const issue = p?.issue;
  const fields = issue?.fields;

  const description = taskEvent.message.replace(/^## Incident: /, '').replace(/^\n### Description\n/, '\n').trim();

  return {
    id: taskEvent.id,
    key: issue?.key || taskEvent.id,
    summary: fields?.summary || '',
    description: description,
    labels: fields?.labels || [],
    projectKey: fields?.project?.key || '',
    projectName: fields?.project?.name || '',
    issueType: fields?.issuetype?.name || 'Task',
    reporter: fields?.reporter?.displayName || 'unknown',
    assignee: fields?.assignee?.displayName || undefined,
    priority: fields?.priority?.name || 'Medium',
    status: fields?.status?.name || 'Open',
    created: fields?.created ? String(fields.created) : undefined,
  };
}
