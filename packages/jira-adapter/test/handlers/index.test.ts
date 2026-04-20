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
      matchAllByLabels(labels) {
        const set = new Set((labels ?? []).map((l) => String(l).toLowerCase()));
        return repos.filter((r) => set.has(r.name.toLowerCase()));
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
    // Task id is now the composite (issueKey, repoName) so parallel fan-out
    // runs don't collapse in the orchestrator's queue.
    assert.equal(emittedEvents[0].payload.id, 'TEST-101:web-app');
    assert.equal(emittedEvents[0].payload.replyTo.id, 'TEST-101');
    assert.equal(emittedEvents[0].payload.context.repoPath, '/repos/web-app');
    assert.equal(emittedEvents[0].payload.context.cwd, '/repos/web-app');
    assert.equal(emittedEvents[0].payload.metadata.matchedRepo, 'web-app');
    assert.equal(emittedEvents[0].payload.metadata.readOnly, true);
    // Single-repo match: no fan-out ack comment posted.
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
    assert.equal(emittedEvents[0].payload.id, 'TEST-104:web-app');
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

  it('analyze + issue_updated + adds a NEW matching label while keeping an old one → analyzes only the new repo (per-repo delta dedup)', async () => {
    registerMatcher([
      { name: 'web-app', path: '/repos/web-app' },
      { name: 'api', path: '/repos/api' },
    ]);
    const context = createMockContext(analyzeCreatedConfig);

    // Issue previously had `web-app` (already analyzed). Someone now also
    // adds `api`. With per-repo delta dedup we DO analyze `api` (first time)
    // but NOT `web-app` (already analyzed on create).
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

    assert.equal(emittedEvents.length, 1);
    assert.equal(emittedEvents[0].payload.id, 'DEDUP-1:api');
    assert.equal(emittedEvents[0].payload.metadata.matchedRepo, 'api');
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

  describe('multi-repo fan-out', () => {
    it('emits one TASK_CREATED per matched repo with distinct composite ids, posts a single ack listing them', async () => {
      registerMatcher([
        { name: 'api', path: '/repos/api' },
        { name: 'web-app', path: '/repos/web-app' },
        { name: 'mobile-app', path: '/repos/mobile-app' },
      ]);
      const context = createMockContext(analyzeCreatedConfig);

      await routeToHandler(
        {},
        makeTaskInfo({ key: 'MULTI-1', labels: ['bug', 'web-app', 'api'] }),
        'jira:issue_created',
        context
      );

      assert.equal(emittedEvents.length, 2);
      const ids = emittedEvents.map((e) => e.payload.id);
      assert.deepEqual(ids, ['MULTI-1:api', 'MULTI-1:web-app']);
      const repoPaths = emittedEvents.map((e) => e.payload.context.repoPath);
      assert.deepEqual(repoPaths, ['/repos/api', '/repos/web-app']);
      // All tasks reply back to the same Jira issue.
      for (const ev of emittedEvents) {
        assert.equal(ev.payload.replyTo.id, 'MULTI-1');
      }

      assert.equal(mockComments.length, 1);
      assert.equal(mockComments[0].issueKey, 'MULTI-1');
      assert.match(mockComments[0].text, /Analyzing this issue across 2 repositories/);
      assert.match(mockComments[0].text, /`api`/);
      assert.match(mockComments[0].text, /`web-app`/);
    });

    it('caps fan-out at maxReposPerIssue and mentions skipped repos in the ack', async () => {
      registerMatcher([
        { name: 'a', path: '/r/a' },
        { name: 'b', path: '/r/b' },
        { name: 'c', path: '/r/c' },
        { name: 'd', path: '/r/d' },
      ]);
      const config: JiraAdapterConfig = {
        maxReposPerIssue: 2,
        webhookBehavior: {
          defaults: { action: 'ignore' },
          events: { 'jira:issue_created': { action: 'analyze' } },
        },
      };
      const context = createMockContext(config);

      await routeToHandler(
        {},
        makeTaskInfo({ key: 'CAP-1', labels: ['a', 'b', 'c', 'd'] }),
        'jira:issue_created',
        context
      );

      assert.equal(emittedEvents.length, 2);
      assert.deepEqual(
        emittedEvents.map((e) => e.payload.metadata.matchedRepo),
        ['a', 'b']
      );
      assert.equal(mockComments.length, 1);
      assert.match(mockComments[0].text, /maxReposPerIssue/);
      assert.match(mockComments[0].text, /`c`/);
      assert.match(mockComments[0].text, /`d`/);
    });

    it('maxReposPerIssue=0 disables the cap (analyzes all matches, notes skipped=none)', async () => {
      registerMatcher([
        { name: 'a', path: '/r/a' },
        { name: 'b', path: '/r/b' },
        { name: 'c', path: '/r/c' },
      ]);
      const config: JiraAdapterConfig = {
        maxReposPerIssue: 0,
        webhookBehavior: {
          defaults: { action: 'ignore' },
          events: { 'jira:issue_created': { action: 'analyze' } },
        },
      };
      const context = createMockContext(config);

      await routeToHandler(
        {},
        makeTaskInfo({ key: 'NOCAP-1', labels: ['a', 'b', 'c'] }),
        'jira:issue_created',
        context
      );

      assert.equal(emittedEvents.length, 3);
      // Single ack still posted because fan-out > 1, but no "skipped" note.
      assert.equal(mockComments.length, 1);
      assert.doesNotMatch(mockComments[0].text, /maxReposPerIssue/);
    });

    it('issue_updated fans out only to NEWLY matched repos (per-repo delta dedup)', async () => {
      registerMatcher([
        { name: 'api', path: '/repos/api' },
        { name: 'web-app', path: '/repos/web-app' },
      ]);
      const context = createMockContext(analyzeCreatedConfig);

      // Issue had `api` before (already analyzed on create). Someone now adds
      // `web-app`. We should analyze `web-app` only — NOT re-run `api`.
      const payload = {
        changelog: {
          items: [
            { field: 'labels', fromString: 'api', toString: 'api web-app' },
          ],
        },
      };

      await routeToHandler(
        payload,
        makeTaskInfo({ key: 'DELTA-1', labels: ['api', 'web-app'] }),
        'jira:issue_updated',
        context
      );

      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].payload.id, 'DELTA-1:web-app');
      assert.equal(emittedEvents[0].payload.metadata.matchedRepo, 'web-app');
      // Single-repo fan-out → no ack comment.
      assert.equal(mockComments.length, 0);
    });

    it('issue_updated with multiple new matches fans out and posts a single ack', async () => {
      registerMatcher([
        { name: 'api', path: '/repos/api' },
        { name: 'web-app', path: '/repos/web-app' },
      ]);
      const context = createMockContext(analyzeCreatedConfig);

      // Issue had no matching labels before. Now someone adds both `api` and
      // `web-app` in one edit. Both should run.
      const payload = {
        changelog: {
          items: [
            { field: 'labels', fromString: 'bug', toString: 'bug api web-app' },
          ],
        },
      };

      await routeToHandler(
        payload,
        makeTaskInfo({ key: 'DELTA-2', labels: ['bug', 'api', 'web-app'] }),
        'jira:issue_updated',
        context
      );

      assert.equal(emittedEvents.length, 2);
      assert.deepEqual(
        emittedEvents.map((e) => e.payload.id),
        ['DELTA-2:api', 'DELTA-2:web-app']
      );
      assert.equal(mockComments.length, 1);
      assert.match(mockComments[0].text, /Analyzing this issue across 2 repositories/);
    });

    it('issue_updated where every currently-matched repo was already matched before → silent (full dedup)', async () => {
      registerMatcher([
        { name: 'api', path: '/repos/api' },
        { name: 'web-app', path: '/repos/web-app' },
      ]);
      const context = createMockContext(analyzeCreatedConfig);

      const payload = {
        changelog: {
          items: [
            // Only unrelated labels changed; the repo-matching labels
            // `api` / `web-app` were present both before and after.
            { field: 'labels', fromString: 'api web-app old-tag', toString: 'api web-app new-tag' },
          ],
        },
      };

      await routeToHandler(
        payload,
        makeTaskInfo({ key: 'DELTA-3', labels: ['api', 'web-app', 'new-tag'] }),
        'jira:issue_updated',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 0);
    });
  });
});
