import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { routeToHandler } from '../../src/handlers/index.js';
import type { HandlerContext } from '../../src/handlers/index.js';
import type { JiraAdapterConfig, JiraTaskInfo } from '../../src/types.js';
import { StandardEvents, REPO_MATCHER_SERVICE, type RepoMatcher } from '@agent-detective/types';

interface MockComment {
  issueKey: string;
  text: string;
  createdAt: string;
}

interface MockJiraClientForTest {
  comments: MockComment[];
  addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }>;
}

function makeTaskInfo(overrides: Partial<JiraTaskInfo> = {}): JiraTaskInfo {
  return {
    id: 'TEST-1',
    key: 'TEST-1',
    summary: 'Test Issue',
    description: 'Description',
    labels: [],
    projectKey: 'TEST',
    ...overrides,
  };
}

describe('Handler Registry', () => {
  let mockComments: MockComment[];
  let mockJiraClient: MockJiraClientForTest;
  let emittedEvents: Array<{ event: string; payload: any }>;
  let services: Map<string, unknown>;

  beforeEach(() => {
    mockComments = [];
    emittedEvents = [];
    services = new Map();
    mockJiraClient = {
      comments: mockComments,
      async addComment(issueKey, commentText) {
        mockComments.push({
          issueKey,
          text: commentText,
          createdAt: new Date().toISOString(),
        });
        return { success: true, issueKey };
      },
    };
  });

  function registerMatcher(
    repos: Array<{ name: string; path: string }>
  ): RepoMatcher {
    const matcher: RepoMatcher = {
      matchByLabels(labels) {
        for (const label of labels ?? []) {
          const hit = repos.find((r) => r.name.toLowerCase() === String(label).toLowerCase());
          if (hit) return hit;
        }
        return null;
      },
      listConfiguredLabels() {
        return repos.map((r) => r.name);
      },
    };
    services.set(REPO_MATCHER_SERVICE, matcher);
    return matcher;
  }

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
    getService: <T>(name: string) => (services.get(name) as T | undefined) ?? null,
  });

  const analyzeCreatedConfig: JiraAdapterConfig = {
    webhookBehavior: {
      defaults: { action: 'ignore' },
      events: {
        'jira:issue_created': { action: 'analyze' },
        'jira:issue_updated': { action: 'analyze' },
      },
    },
  };

  it('routes to acknowledge handler for jira:issue_updated when configured', async () => {
    const config: JiraAdapterConfig = {
      webhookBehavior: {
        defaults: { action: 'ignore', acknowledgmentMessage: 'Default message' },
        events: {
          'jira:issue_updated': { action: 'acknowledge' },
        },
      },
    };

    const context = createMockContext(config);

    await routeToHandler({}, makeTaskInfo(), 'jira:issue_updated', context);

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

    await routeToHandler({}, makeTaskInfo({ key: 'TEST-2' }), 'jira:unknown_event', context);

    assert.equal(mockComments.length, 0);
  });

  it('analyze + label match on issue_created → emits TASK_CREATED with pre-set repoPath', async () => {
    registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
    const context = createMockContext(analyzeCreatedConfig);

    await routeToHandler(
      {},
      makeTaskInfo({
        key: 'TEST-101',
        description: 'The app crashes on startup',
        labels: ['bug', 'web-app'],
      }),
      'jira:issue_created',
      context
    );

    assert.equal(emittedEvents.length, 1);
    assert.equal(emittedEvents[0].event, StandardEvents.TASK_CREATED);
    assert.equal(emittedEvents[0].payload.id, 'TEST-101');
    assert.equal(emittedEvents[0].payload.context.repoPath, '/repos/web-app');
    assert.equal(emittedEvents[0].payload.context.cwd, '/repos/web-app');
    assert.equal(emittedEvents[0].payload.metadata.matchedRepo, 'web-app');
    assert.equal(emittedEvents[0].payload.metadata.readOnly, true);
    assert.equal(mockComments.length, 0);
  });

  it('analyze + no matching label on issue_created → posts missing-labels comment, no task', async () => {
    registerMatcher([
      { name: 'web-app', path: '/repos/web-app' },
      { name: 'mobile-app', path: '/repos/mobile-app' },
    ]);
    const context = createMockContext(analyzeCreatedConfig);

    await routeToHandler(
      {},
      makeTaskInfo({ key: 'TEST-102', labels: ['bug', 'frontend'] }),
      'jira:issue_created',
      context
    );

    assert.equal(emittedEvents.length, 0);
    assert.equal(mockComments.length, 1);
    assert.equal(mockComments[0].issueKey, 'TEST-102');
    assert.match(mockComments[0].text, /web-app/);
    assert.match(mockComments[0].text, /mobile-app/);
  });

  it('analyze + issue_updated with no label added → silent', async () => {
    registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
    const context = createMockContext(analyzeCreatedConfig);

    const payload = {
      changelog: {
        items: [{ field: 'status', fromString: 'Open', toString: 'In Progress' }],
      },
    };

    await routeToHandler(
      payload,
      makeTaskInfo({ key: 'TEST-103', labels: ['web-app'] }),
      'jira:issue_updated',
      context
    );

    assert.equal(emittedEvents.length, 0);
    assert.equal(mockComments.length, 0);
  });

  it('analyze + issue_updated with label added that matches → emits TASK_CREATED', async () => {
    registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
    const context = createMockContext(analyzeCreatedConfig);

    const payload = {
      changelog: {
        items: [
          { field: 'labels', fromString: 'bug', toString: 'bug web-app' },
        ],
      },
    };

    await routeToHandler(
      payload,
      makeTaskInfo({ key: 'TEST-104', labels: ['bug', 'web-app'] }),
      'jira:issue_updated',
      context
    );

    assert.equal(emittedEvents.length, 1);
    assert.equal(emittedEvents[0].event, StandardEvents.TASK_CREATED);
    assert.equal(emittedEvents[0].payload.context.repoPath, '/repos/web-app');
    assert.equal(mockComments.length, 0);
  });

  it('analyze + issue_updated with label added that does NOT match → silent', async () => {
    registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
    const context = createMockContext(analyzeCreatedConfig);

    const payload = {
      changelog: {
        items: [
          { field: 'labels', fromString: '', toString: 'frontend' },
        ],
      },
    };

    await routeToHandler(
      payload,
      makeTaskInfo({ key: 'TEST-105', labels: ['frontend'] }),
      'jira:issue_updated',
      context
    );

    assert.equal(emittedEvents.length, 0);
    assert.equal(mockComments.length, 0);
  });

  it('analyze + issue_updated + label added matches but issue ALREADY had a matching label before → skip (dedup)', async () => {
    registerMatcher([
      { name: 'web-app', path: '/repos/web-app' },
      { name: 'api', path: '/repos/api' },
    ]);
    const context = createMockContext(analyzeCreatedConfig);

    // Issue previously had `web-app` (already matched → analyzed on create).
    // Someone now also adds `api`. We should stay silent to avoid re-analyzing.
    const payload = {
      changelog: {
        items: [
          { field: 'labels', fromString: 'web-app', toString: 'web-app api' },
        ],
      },
    };

    await routeToHandler(
      payload,
      makeTaskInfo({ key: 'DEDUP-1', labels: ['web-app', 'api'] }),
      'jira:issue_updated',
      context
    );

    assert.equal(emittedEvents.length, 0);
    assert.equal(mockComments.length, 0);
  });

  it('analyze + issue_updated + first matching label ever added → emits (not a dedup case)', async () => {
    registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
    const context = createMockContext(analyzeCreatedConfig);

    // Previously only unrelated labels. Now `web-app` is added — first time
    // this issue is analyzable, so we DO want analysis to run.
    const payload = {
      changelog: {
        items: [
          { field: 'labels', fromString: 'bug frontend', toString: 'bug frontend web-app' },
        ],
      },
    };

    await routeToHandler(
      payload,
      makeTaskInfo({ key: 'DEDUP-2', labels: ['bug', 'frontend', 'web-app'] }),
      'jira:issue_updated',
      context
    );

    assert.equal(emittedEvents.length, 1);
    assert.equal(emittedEvents[0].payload.context.repoPath, '/repos/web-app');
  });

  it('analyze + issue_updated + label added matches (even when other fields also changed) → emits', async () => {
    registerMatcher([{ name: 'api', path: '/repos/api' }]);
    const context = createMockContext(analyzeCreatedConfig);

    const payload = {
      changelog: {
        items: [
          { field: 'status', fromString: 'Open', toString: 'In Progress' },
          { field: 'labels', fromString: '', toString: 'api' },
        ],
      },
    };

    await routeToHandler(
      payload,
      makeTaskInfo({ key: 'TEST-106', labels: ['api'] }),
      'jira:issue_updated',
      context
    );

    assert.equal(emittedEvents.length, 1);
    assert.equal(emittedEvents[0].payload.context.repoPath, '/repos/api');
  });

  it('analyze with no RepoMatcher registered → logs warning, takes no action', async () => {
    const context = createMockContext(analyzeCreatedConfig);

    await routeToHandler(
      {},
      makeTaskInfo({ key: 'TEST-107', labels: ['web-app'] }),
      'jira:issue_created',
      context
    );

    assert.equal(emittedEvents.length, 0);
    assert.equal(mockComments.length, 0);
  });

  it('honors analysisReadOnly=false to allow write-capable analysis', async () => {
    registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
    const config: JiraAdapterConfig = {
      analysisReadOnly: false,
      webhookBehavior: {
        defaults: { action: 'ignore' },
        events: { 'jira:issue_created': { action: 'analyze' } },
      },
    };
    const context = createMockContext(config);

    await routeToHandler(
      {},
      makeTaskInfo({ key: 'TEST-202', labels: ['web-app'] }),
      'jira:issue_created',
      context
    );

    assert.equal(emittedEvents.length, 1);
    assert.equal(emittedEvents[0].payload.metadata.readOnly, false);
  });

  it('missing-labels comment can be overridden via missingLabelsMessage', async () => {
    registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
    const config: JiraAdapterConfig = {
      missingLabelsMessage: 'Add one of: {available_labels} to {issue_key}.',
      webhookBehavior: {
        defaults: { action: 'ignore' },
        events: { 'jira:issue_created': { action: 'analyze' } },
      },
    };
    const context = createMockContext(config);

    await routeToHandler(
      {},
      makeTaskInfo({ key: 'TEST-203', labels: ['bug'] }),
      'jira:issue_created',
      context
    );

    assert.equal(mockComments.length, 1);
    assert.match(mockComments[0].text, /Add one of: .*web-app.* to TEST-203\./);
  });
});
