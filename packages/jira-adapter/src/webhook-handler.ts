import { normalizeJiraPayload } from './normalizer.js';
import type { JiraTaskInfo, JiraPayload } from './types.js';
import { routeToHandler, HandlerContext } from './handlers/index.js';

export function createJiraWebhookHandler(options: HandlerContext) {
  const handlerContext: HandlerContext = { ...options };

  async function handleWebhook(
    payload: unknown,
    webhookEvent: string
  ): Promise<{ status: string; taskId: string }> {
    const taskEvent = normalizeJiraPayload(payload as JiraPayload);

    const taskInfo = extractTaskInfo(payload, taskEvent, webhookEvent);

    await routeToHandler(payload, taskInfo, webhookEvent, handlerContext);

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
