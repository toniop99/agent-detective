import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { routeToHandler } from '../../src/handlers/index.js';
import type { HandlerContext } from '../../src/handlers/index.js';
import type { JiraAdapterConfig } from '../../src/types.js';
import { StandardEvents } from '@agent-detective/types';

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
  let emittedEvents: Array<{ event: string, payload: any }>;

  beforeEach(() => {
    mockComments = [];
    emittedEvents = [];
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

  const createMockContext = (config: JiraAdapterConfig): HandlerContext => ({
    jiraClient: mockJiraClient as unknown as HandlerContext['jiraClient'],
    config,
    events: {
      emit: (event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      },
      on: () => {},
      off: () => {},
      invokeAsync: async () => [],
    },
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

    const context = createMockContext(config);

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

    const context = createMockContext(config);

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

  it('emits task:created for analyze action', async () => {
    const config: JiraAdapterConfig = {
      webhookBehavior: {
        defaults: { action: 'ignore' },
        events: {
          'jira:issue_created': { action: 'analyze' },
        },
      },
    };

    const context = createMockContext(config);

    const taskInfo = {
      id: '10001',
      key: 'TEST-101',
      summary: 'New bug found',
      description: 'The app crashes on startup',
      labels: ['bug', 'critical'],
      projectKey: 'TEST',
    };

    await routeToHandler({}, taskInfo, 'jira:issue_created', context);

    assert.equal(emittedEvents.length, 1);
    assert.equal(emittedEvents[0].event, StandardEvents.TASK_CREATED);
    assert.equal(emittedEvents[0].payload.id, 'TEST-101');
    assert.equal(emittedEvents[0].payload.message, 'The app crashes on startup');
    assert.equal(emittedEvents[0].payload.metadata.requiresCodeContext, true);
    assert.deepEqual(emittedEvents[0].payload.metadata.labels, ['bug', 'critical']);
  });
});
