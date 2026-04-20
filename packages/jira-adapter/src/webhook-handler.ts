import { z } from 'zod';
import { normalizeJiraPayload } from './normalizer.js';
import type { JiraTaskInfo, JiraPayload } from './types.js';
import { routeToHandler, HandlerContext } from './handlers/index.js';

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
        id: z.string().optional(),
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
  })
  .loose();

export class JiraWebhookPayloadError extends Error {
  readonly statusCode = 400;
  readonly issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    super(`Invalid Jira webhook payload: ${JSON.stringify(issues).slice(0, 500)}`);
    this.name = 'JiraWebhookPayloadError';
    this.issues = issues;
  }
}

export function createJiraWebhookHandler(options: HandlerContext) {
  const handlerContext: HandlerContext = options;

  async function handleWebhook(
    payload: unknown,
    webhookEvent: string
  ): Promise<{ status: string; taskId: string }> {
    const parsed = webhookEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new JiraWebhookPayloadError(parsed.error.issues);
    }

    const envelope = parsed.data as JiraPayload;
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
