import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { routeToHandler } from '../../src/handlers/index.js';
import type { HandlerContext } from '../../src/handlers/index.js';
import type { JiraAdapterConfig } from '../../src/types.js';

interface MockComment {
  issueKey: string;
  text: string;
  createdAt: string;
}

interface MockJiraClientForTest {
  comments: MockComment[];
  addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }>;
}

describe('Handler Registry', () => {
  let mockComments: MockComment[];
  let mockJiraClient: MockJiraClientForTest;

  beforeEach(() => {
    mockComments = [];
    mockJiraClient = {
      comments: mockComments,
      async addComment(issueKey: string, commentText: string) {
        mockComments.push({
          issueKey,
          text: commentText,
          createdAt: new Date().toISOString(),
        });
        return { success: true, issueKey };
      },
    };
  });

  it('routes to acknowledge handler for jira:issue_updated', async () => {
    const config: JiraAdapterConfig = {
      webhookBehavior: {
        defaults: { action: 'ignore', acknowledgmentMessage: 'Default message' },
        events: {
          'jira:issue_updated': { action: 'acknowledge' },
        },
      },
    };

    const context: HandlerContext = {
      jiraClient: mockJiraClient as unknown as HandlerContext['jiraClient'],
      config,
      agentRunner: {} as HandlerContext['agentRunner'],
      enqueue: async (_key: string, fn: () => Promise<void>) => { await fn(); },
      getAvailableRepos: () => [],
      buildRepoContext: async () => ({}),
      formatRepoContextForPrompt: () => '',
    };

    const taskInfo = {
      id: 'TEST-1',
      key: 'TEST-1',
      summary: 'Test Issue',
      description: 'Description',
      labels: [],
      projectKey: 'TEST',
    };

    await routeToHandler({}, taskInfo, 'jira:issue_updated', context);

    assert.equal(mockComments.length, 1);
    assert.equal(mockComments[0].text, 'Default message');
  });

  it('routes to ignore handler for unknown events', async () => {
    const config: JiraAdapterConfig = {
      webhookBehavior: {
        defaults: { action: 'ignore' },
        events: {},
      },
    };

    const context: HandlerContext = {
      jiraClient: mockJiraClient as unknown as HandlerContext['jiraClient'],
      config,
      agentRunner: {} as HandlerContext['agentRunner'],
      enqueue: async (_key: string, fn: () => Promise<void>) => { await fn(); },
      getAvailableRepos: () => [],
      buildRepoContext: async () => ({}),
      formatRepoContextForPrompt: () => '',
    };

    const taskInfo = {
      id: 'TEST-2',
      key: 'TEST-2',
      summary: 'Unknown Event',
      description: '',
      labels: [],
      projectKey: 'TEST',
    };

    await routeToHandler({}, taskInfo, 'jira:unknown_event', context);

    assert.equal(mockComments.length, 0);
  });

  it('uses event-specific acknowledgment message when configured', async () => {
    const config: JiraAdapterConfig = {
      webhookBehavior: {
        defaults: { action: 'ignore', acknowledgmentMessage: 'Default' },
        events: {
          'jira:issue_updated': { action: 'acknowledge', acknowledgmentMessage: 'Custom message for updates' },
        },
      },
    };

    const context: HandlerContext = {
      jiraClient: mockJiraClient as unknown as HandlerContext['jiraClient'],
      config,
      agentRunner: {} as HandlerContext['agentRunner'],
      enqueue: async (_key: string, fn: () => Promise<void>) => { await fn(); },
      getAvailableRepos: () => [],
      buildRepoContext: async () => ({}),
      formatRepoContextForPrompt: () => '',
    };

    const taskInfo = {
      id: 'TEST-3',
      key: 'TEST-3',
      summary: 'Updated Issue',
      description: '',
      labels: [],
      projectKey: 'TEST',
    };

    await routeToHandler({}, taskInfo, 'jira:issue_updated', context);

    assert.equal(mockComments.length, 1);
    assert.equal(mockComments[0].text, 'Custom message for updates');
  });
});
