import type { Request, Response } from 'express';
import {
  Controller,
  Post,
  Summary,
  Description,
  Tags,
  Response as OpenApiResponse,
  RequestBody,
} from '@agent-detective/core';
import type { JiraWebhookResponse } from './webhook-types.js';
import type { Logger } from '@agent-detective/types';
import { JiraWebhookPayloadError } from './webhook-handler.js';

type JiraWebhookHandler = ReturnType<typeof import('./webhook-handler.js').createJiraWebhookHandler>;

const PLUGIN_TAG = '@agent-detective/jira-adapter';

@Controller('/webhook/jira', { tags: [PLUGIN_TAG], description: 'Jira webhook endpoints' })
export class JiraWebhookController {
  private webhookHandler?: JiraWebhookHandler;
  private logger?: Logger;

  setWebhookHandler(handler: JiraWebhookHandler): void {
    this.webhookHandler = handler;
  }

  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  @Post('/')
  @Summary('Handle Jira webhook')
  @Description('Receives and processes Jira webhook events for issue created, updated, or deleted')
  @Tags(PLUGIN_TAG)
  @RequestBody({
    description: 'Jira webhook payload containing event information',
    required: true,
    example: {
      webhookEvent: 'jira:issue_created',
      timestamp: 1713222000000,
      issue: {
        id: '12345',
        key: 'PROJ-123',
        fields: {
          summary: 'Bug in user login',
          description: 'Users are unable to login with SSO',
          issuetype: {
            id: '1',
            name: 'Bug',
            subtask: false,
          },
          priority: {
            id: '3',
            name: 'High',
          },
          status: {
            id: '1',
            name: 'Open',
            statusCategory: {
              id: '2',
              key: 'new',
              name: 'To Do',
            },
          },
          project: {
            id: '10000',
            key: 'PROJ',
            name: 'My Project',
          },
          assignee: {
            accountId: 'user123',
            displayName: 'John Developer',
            emailAddress: 'john@example.com',
            active: true,
          },
          reporter: {
            accountId: 'user456',
            displayName: 'Jane Reporter',
            emailAddress: 'jane@example.com',
            active: true,
          },
          labels: ['bug', 'login', 'sso'],
          created: '2026-04-01T10:00:00.000Z',
          updated: '2026-04-15T14:30:00.000Z',
        },
      },
      user: {
        accountId: 'user456',
        displayName: 'Jane Reporter',
        emailAddress: 'jane@example.com',
        active: true,
      },
    },
    schema: {
      type: 'object',
      properties: {
        webhookEvent: { type: 'string', description: 'The type of Jira event' },
        timestamp: { type: 'number', description: 'Event timestamp in milliseconds' },
        issue: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            key: { type: 'string' },
            fields: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
                description: { type: 'string', nullable: true },
                issuetype: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    subtask: { type: 'boolean' },
                  },
                },
                priority: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
                status: { type: 'object' },
                project: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    key: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
                assignee: { type: 'object', nullable: true },
                reporter: { type: 'object', nullable: true },
                labels: { type: 'array', items: { type: 'string' } },
                created: { type: 'string' },
                updated: { type: 'string' },
              },
            },
          },
        },
        user: { type: 'object' },
      },
    },
  })
  @OpenApiResponse(200, 'Success', {
    example: {
      status: 'success',
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      message: 'Issue PROJ-123 queued for analysis',
    },
  })
  @OpenApiResponse(200, 'Ignored', {
    example: {
      status: 'ignored',
      message: 'Event jira:issue_deleted not configured for processing',
    },
  })
  @OpenApiResponse(500, 'Error processing webhook', {
    example: {
      status: 'error',
      message: 'Failed to process webhook: Invalid payload',
    },
  })
  async handleWebhook(req: Request, res: Response): Promise<void> {
    if (!this.webhookHandler) {
      res.status(503).json({ status: 'error', message: 'Webhook handler not available' } as JiraWebhookResponse);
      return;
    }

    try {
      const resolved = resolveWebhookEvent(req);
      if (resolved.source !== 'body.webhookEvent' || resolved.event !== resolved.rawEvent) {
        const rawSuffix =
          resolved.rawEvent && resolved.rawEvent !== resolved.event
            ? ` (raw="${resolved.rawEvent}")`
            : '';
        this.logger?.info(
          `Resolved webhook event from ${resolved.source}: ${resolved.event}${rawSuffix}`
        );
      }
      const result = await this.webhookHandler.handleWebhook(req.body, resolved.event);
      res.json(result);
    } catch (err) {
      if (err instanceof JiraWebhookPayloadError) {
        this.logger?.warn(
          `Jira webhook rejected (malformed payload): ${err.message} summary=${JSON.stringify(err.summary)}`
        );
        res.status(400).json({ status: 'error', message: err.message } as JiraWebhookResponse);
        return;
      }
      this.logger?.error(`Jira webhook error: ${(err as Error).message}`);
      res.status(500).json({ status: 'error', message: (err as Error).message } as JiraWebhookResponse);
    }
  }
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
  issue_commented: 'jira:issue_commented',
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
 * Last-resort inference from the payload shape itself, used when none of the
 * explicit event sources (body.webhookEvent, issue_event_type_name,
 * eventTypeName, query.webhookEvent) is populated. This is the common case
 * for Jira Automation's "Send web request" action in "Automation format"
 * when the user didn't add `?webhookEvent=…` to the URL.
 *
 * Heuristics (only when the payload clearly represents an issue event):
 *   - a `changelog` (with items) is present         → `jira:issue_updated`
 *   - otherwise, but the payload looks like an issue → `jira:issue_created`
 *
 * Returns `null` when the payload isn't recognizable as either shape, so the
 * caller can keep falling through to the final `unknown` fallback.
 */
function inferEventFromPayloadShape(body: Record<string, unknown>): string | null {
  const changelog = body.changelog as Record<string, unknown> | undefined;
  const hasChangelogItems =
    !!changelog &&
    typeof changelog === 'object' &&
    Array.isArray(changelog.items) &&
    (changelog.items as unknown[]).length > 0;

  const isEnvelope = !!body.issue && typeof body.issue === 'object';
  const isBareIssue =
    typeof body.key === 'string' && !!body.fields && typeof body.fields === 'object';

  if (!isEnvelope && !isBareIssue) return null;
  return hasChangelogItems ? 'jira:issue_updated' : 'jira:issue_created';
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
export function resolveWebhookEvent(req: Request): ResolvedWebhookEvent {
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
  if (inferred) return pick(inferred, 'payload.shape');

  return { event: 'unknown', rawEvent: '', source: 'fallback' };
}
