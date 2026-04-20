import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createJiraWebhookHandler,
  JiraWebhookPayloadError,
} from '../src/webhook-handler.js';
import type { HandlerContext } from '../src/handlers/index.js';
import type { EventBus, Logger } from '@agent-detective/types';

function createNoopContext(): HandlerContext {
  const noopLogger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const noopBus: EventBus = {
    emit: () => true,
    on: () => noopBus,
    off: () => noopBus,
  } as unknown as EventBus;
  void noopLogger;
  return {
    jiraClient: {
      async addComment() {
        return { success: true, issueKey: 'X' };
      },
      async getIssue() {
        return null;
      },
      async updateIssue() {
        return { success: true };
      },
      async getComments() {
        return [];
      },
      clear() {},
    },
    config: {
      webhookBehavior: {
        defaults: { action: 'ignore' },
        events: {},
      },
    },
    events: noopBus,
  };
}

describe('webhook-handler envelope validation', () => {
  it('rejects non-object payloads with JiraWebhookPayloadError (400)', async () => {
    const { handleWebhook } = createJiraWebhookHandler(createNoopContext());
    await assert.rejects(
      () => handleWebhook('not-an-object', 'jira:issue_created'),
      (err: unknown) => err instanceof JiraWebhookPayloadError && (err as JiraWebhookPayloadError).statusCode === 400
    );
  });

  it('rejects when issue.key is not a string', async () => {
    const { handleWebhook } = createJiraWebhookHandler(createNoopContext());
    await assert.rejects(
      () => handleWebhook({ issue: { key: 123 } }, 'jira:issue_created'),
      JiraWebhookPayloadError
    );
  });

  it('accepts a minimal valid envelope and returns a taskId', async () => {
    const { handleWebhook } = createJiraWebhookHandler(createNoopContext());
    const result = await handleWebhook(
      { webhookEvent: 'jira:issue_created', issue: { key: 'KAN-1', fields: { summary: 's' } } },
      'jira:issue_created'
    );
    assert.equal(result.status, 'queued');
    assert.equal(result.taskId, 'KAN-1');
  });
});
