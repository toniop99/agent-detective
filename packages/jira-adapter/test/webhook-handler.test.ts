import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createJiraWebhookHandler,
  JiraWebhookPayloadError,
  normalizeWebhookShape,
  summarizeWebhookPayload,
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

  it('accepts numeric issue.id (Automation for Jira) and coerces it to string', async () => {
    const { handleWebhook } = createJiraWebhookHandler(createNoopContext());
    const result = await handleWebhook(
      {
        webhookEvent: 'jira:issue_created',
        timestamp: 1776719827225,
        issue: {
          id: 10010,
          key: 'KAN-4',
          self: 'https://example.atlassian.net/rest/api/2/issue/10010',
          fields: { summary: 's' },
        },
      },
      'jira:issue_created'
    );
    assert.equal(result.status, 'queued');
    assert.equal(result.taskId, 'KAN-4');
  });

  it('accepts a bare-issue payload (Automation format) and wraps it', async () => {
    const { handleWebhook } = createJiraWebhookHandler(createNoopContext());
    const result = await handleWebhook(
      {
        self: 'https://example.atlassian.net/rest/api/2/issue/10045',
        id: 10045,
        key: 'KAN-7',
        fields: {
          summary: 'Bug in user login',
          description: 'Users cannot sign in via SSO',
          labels: ['bug'],
        },
        changelog: { histories: [] },
        renderedFields: {},
      },
      'jira:issue_created'
    );
    assert.equal(result.status, 'queued');
    assert.equal(result.taskId, 'KAN-7');
  });

  it('accepts Automation format with numeric id and full fields (issue_data_automation_format payload)', async () => {
    const { handleWebhook } = createJiraWebhookHandler(createNoopContext());
    const result = await handleWebhook(
      {
        self: 'https://example.atlassian.net/rest/api/2/issue/10045',
        id: 10045,
        key: 'KAN-123',
        changelog: { startAt: 0, maxResults: 0, total: 0, histories: null },
        fields: {
          statuscategorychangedate: '2024-01-15T10:30:00.000+0000',
          issuetype: {
            self: 'https://example.atlassian.net/rest/api/2/issuetype/10001',
            id: '10001',
            description: 'A bug in the system',
            name: 'Bug',
            subtask: false,
          },
          project: {
            self: 'https://example.atlassian.net/rest/api/2/project/10000',
            id: '10000',
            key: 'KAN',
            name: 'Kanban Project',
          },
          labels: ['frontend', 'urgent'],
          summary: 'Login button not working on mobile',
          description: 'The login button does not respond to taps on mobile devices',
          priority: {
            self: 'https://example.atlassian.net/rest/api/2/priority/1',
            id: '1',
            name: 'Highest',
          },
          status: {
            self: 'https://example.atlassian.net/rest/api/2/status/1',
            name: 'Open',
            statusCategory: { id: 2, key: 'new', name: 'To Do' },
          },
          assignee: {
            accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
            displayName: 'Jane Developer',
            emailAddress: 'jane@example.com',
            active: true,
          },
          reporter: {
            accountId: 'bbbbbbbbbbbbbbbbbbbbbbbbbb',
            displayName: 'John Reporter',
            emailAddress: 'john@example.com',
            active: true,
          },
          created: 1705312200000,
          updated: 1705315800000,
        },
      },
      'jira:issue_created'
    );
    assert.equal(result.status, 'queued');
    assert.equal(result.taskId, 'KAN-123');
  });
});

describe('normalizeWebhookShape', () => {
  it('detects envelope shape and passes it through', () => {
    const input = { issue: { key: 'KAN-1', fields: { summary: 's' } } };
    const { payload, shape } = normalizeWebhookShape(input);
    assert.equal(shape, 'envelope');
    assert.strictEqual(payload, input);
  });

  it('detects bare-issue shape and wraps it under `issue`', () => {
    const input = {
      self: 'https://example.atlassian.net/rest/api/2/issue/10045',
      id: 10045,
      key: 'KAN-7',
      fields: { summary: 's' },
    };
    const { payload, shape } = normalizeWebhookShape(input);
    assert.equal(shape, 'bare-issue');
    const wrapped = payload as { issue: Record<string, unknown> };
    assert.equal(wrapped.issue.key, 'KAN-7');
    assert.deepEqual(wrapped.issue.fields, { summary: 's' });
  });

  it('returns unknown shape for non-object payloads', () => {
    const { shape } = normalizeWebhookShape('garbage');
    assert.equal(shape, 'unknown');
  });

  it('requires both `key` and `fields` to detect bare-issue (avoids false positives)', () => {
    const { shape } = normalizeWebhookShape({ key: 'KAN-1' });
    assert.equal(shape, 'unknown');
  });
});

describe('summarizeWebhookPayload', () => {
  it('surfaces the detected shape for bare-issue payloads', () => {
    const summary = summarizeWebhookPayload({
      self: 'x',
      id: 1,
      key: 'KAN-9',
      fields: { summary: 'hello' },
    });
    assert.equal(summary.shape, 'bare-issue');
    const issue = summary.issue as { key: string; fieldKeys: string[] };
    assert.equal(issue.key, 'KAN-9');
    assert.deepEqual(issue.fieldKeys, ['summary']);
  });

  it('surfaces the detected shape for envelope payloads', () => {
    const summary = summarizeWebhookPayload({
      issue: { key: 'KAN-9', fields: { summary: 'hello' } },
    });
    assert.equal(summary.shape, 'envelope');
  });
});
