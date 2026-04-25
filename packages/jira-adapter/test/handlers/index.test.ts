import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  routeToHandler,
  __resetMissingLabelsReminderStateForTests,
  __resetAnalysisCooldownForTests,
} from '../../src/application/handlers/index.js';
import type { HandlerContext } from '../../src/application/handlers/index.js';
import type { JiraAdapterConfig, JiraTaskInfo } from '../../src/domain/types.js';
import type { JiraAttachmentRecord, JiraCommentRecord } from '../../src/infrastructure/jira-client.js';
import { AGENT_DETECTIVE_MARKER } from '../../src/domain/comment-trigger.js';
import {
  PR_WORKFLOW_SERVICE,
  REPO_MATCHER_SERVICE,
  StandardEvents,
  type PrWorkflowInput,
  type PrWorkflowService,
  type RepoMatcher,
} from '@agent-detective/types';

interface MockComment {
  issueKey: string;
  text: string;
  createdAt: string;
}

interface MockJiraClientForTest {
  comments: MockComment[];
  issueComments: JiraCommentRecord[];
  addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }>;
  getComments(issueKey: string): Promise<JiraCommentRecord[]>;
  getAttachments(issueKey: string): Promise<JiraAttachmentRecord[]>;
  downloadAttachment(attachmentId: string): Promise<Buffer>;
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

  let mockIssueComments: JiraCommentRecord[];

  beforeEach(() => {
    mockComments = [];
    mockIssueComments = [];
    emittedEvents = [];
    services = new Map();
    __resetMissingLabelsReminderStateForTests();
    __resetAnalysisCooldownForTests();
    mockJiraClient = {
      comments: mockComments,
      issueComments: mockIssueComments,
      async addComment(issueKey, commentText) {
        mockComments.push({
          issueKey,
          text: commentText,
          createdAt: new Date().toISOString(),
        });
        return { success: true, issueKey };
      },
      async getComments(_issueKey) {
        return mockIssueComments;
      },
      async getAttachments(_issueKey) {
        return [];
      },
      async downloadAttachment(_id) {
        return Buffer.alloc(0);
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

  /**
   * The default wiring the adapter ships with today:
   *   - `jira:issue_created` → analyze (fan out on match, reminder on miss).
   *   - `jira:comment_created` → analyze (trigger-phrase gated retry).
   *   - Everything else → ignore (no changelog dedup, no silent updates).
   */
  const analyzeConfig: JiraAdapterConfig = {
    retryTriggerPhrase: '#agent-detective analyze',
    webhookBehavior: {
      defaults: { action: 'ignore' },
      events: {
        'jira:issue_created': { action: 'analyze' },
        'jira:comment_created': { action: 'analyze' },
      },
    },
  };

  describe('routing', () => {
    it('routes to acknowledge handler for jira:issue_updated when explicitly configured', async () => {
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
      assert.match(mockComments[0].text, /^Default message/);
      // Every comment we post carries the marker so future comment_created
      // events authored by us are filtered out.
      assert.ok(mockComments[0].text.includes(AGENT_DETECTIVE_MARKER));
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

    it('default behavior for jira:issue_updated is ignore (no changelog-based retry anymore)', async () => {
      // `analyzeConfig` does not configure issue_updated, so `defaults.action = ignore`
      // is what gets picked up — the adapter stays silent on issue_updated edits.
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        { changelog: { items: [{ field: 'labels', fromString: '', toString: 'web-app' }] } },
        makeTaskInfo({ key: 'TEST-3', labels: ['web-app'] }),
        'jira:issue_updated',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 0);
    });

    it('analyze with no RepoMatcher registered → logs warning, takes no action', async () => {
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        {},
        makeTaskInfo({ key: 'TEST-107', labels: ['web-app'] }),
        'jira:issue_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 0);
    });
  });

  describe('issue_created → analyze', () => {
    it('label match → emits TASK_CREATED with pre-set repoPath; no ack for single-repo match', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

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
      assert.equal(emittedEvents[0].payload.id, 'TEST-101:web-app');
      assert.equal(emittedEvents[0].payload.replyTo.id, 'TEST-101');
      assert.equal(emittedEvents[0].payload.context.repoPath, '/repos/web-app');
      assert.equal(emittedEvents[0].payload.context.cwd, '/repos/web-app');
      assert.equal(emittedEvents[0].payload.metadata.matchedRepo, 'web-app');
      assert.equal(emittedEvents[0].payload.metadata.readOnly, true);
      assert.equal(mockComments.length, 0);
    });

    it('no matching label → posts missing-labels comment with trigger phrase, no task', async () => {
      registerMatcher([
        { name: 'web-app', path: '/repos/web-app' },
        { name: 'mobile-app', path: '/repos/mobile-app' },
      ]);
      const context = createMockContext(analyzeConfig);

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
      // The default missing-labels copy instructs the user about the retry
      // phrase, which is now the only way to re-run the match.
      assert.match(mockComments[0].text, /#agent-detective analyze/);
      // And it's stamped with the marker so the user's own retry comment
      // is the only `comment_created` that passes the own-comment filter.
      assert.ok(mockComments[0].text.includes(AGENT_DETECTIVE_MARKER));
    });

    it('rate-limits missing-labels reminders per issue within the dedup window (loop guard)', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      // First create: expected to post the reminder.
      await routeToHandler(
        {},
        makeTaskInfo({ key: 'LOOP-1', labels: ['bug'] }),
        'jira:issue_created',
        context
      );
      assert.equal(mockComments.length, 1);

      // Simulate the pathological loop: Jira echoes our reminder back as a
      // `jira:comment_created` that — somehow — slips past both own-comment
      // signals (no marker in body, no jiraUser identity configured) AND
      // contains the trigger phrase because the reminder quotes it. The
      // rate-limit is the last line of defense.
      await routeToHandler(
        {
          comment: {
            body: 'None of this issue\'s labels match. Comment #agent-detective analyze to retry.',
            author: { accountId: 'anon' },
          },
        },
        makeTaskInfo({ key: 'LOOP-1', labels: ['bug'] }),
        'jira:comment_created',
        context
      );

      // No new reminder; the loop is broken even if every upstream guard fails.
      assert.equal(mockComments.length, 1, 'second reminder should be suppressed by rate-limit');
      assert.equal(emittedEvents.length, 0);
    });

    // Regression for the webhook-echo loop described in docs/e2e/jira-manual-e2e.md.
    // When the adapter posts an analysis comment, Jira Automation rules that
    // fire on "issue updated" can POST the issue back to us. The event
    // classifier normally catches these via `detectChangelogActivity`, but
    // some Automation configurations send a bare-issue payload with no
    // changelog signal at all, and we conservatively classify those as
    // `issue_created`. The per-(issue, repo) cooldown is the final defense:
    // even if classification is wrong, the same pair won't analyze twice
    // within the cooldown window.
    it('suppresses a second auto-analysis of the same (issue, repo) within the cooldown window', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        {},
        makeTaskInfo({ key: 'LOOP-2', labels: ['web-app'] }),
        'jira:issue_created',
        context
      );
      assert.equal(emittedEvents.length, 1, 'first analysis should emit a task');

      // Simulate the echo: same issue, same repo, same "issue_created"
      // classification (as happens when payload-shape inference misfires).
      await routeToHandler(
        {},
        makeTaskInfo({ key: 'LOOP-2', labels: ['web-app'] }),
        'jira:issue_created',
        context
      );

      assert.equal(
        emittedEvents.length,
        1,
        'second auto-analysis of the same (issue, repo) should be suppressed'
      );
    });

    it('still fans out across OTHER repos when only some (issue, repo) pairs are cooling down', async () => {
      registerMatcher([
        { name: 'web-app', path: '/repos/web-app' },
        { name: 'api', path: '/repos/api' },
      ]);
      const context = createMockContext(analyzeConfig);

      // First run analyzes web-app only.
      await routeToHandler(
        {},
        makeTaskInfo({ key: 'LOOP-3', labels: ['web-app'] }),
        'jira:issue_created',
        context
      );
      assert.equal(emittedEvents.length, 1);

      // Second run now matches both web-app (cooling down) and api (fresh).
      // web-app should be skipped; api should still fire.
      await routeToHandler(
        {},
        makeTaskInfo({ key: 'LOOP-3', labels: ['web-app', 'api'] }),
        'jira:issue_created',
        context
      );

      const emittedRepos = emittedEvents.map((e) => e.payload.metadata.matchedRepo);
      assert.deepEqual(
        emittedRepos,
        ['web-app', 'api'],
        'api is fresh and should analyze; web-app stays suppressed'
      );
    });

    it('explicit comment retries bypass the cooldown (a human asked for it)', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      // Prime the cooldown.
      await routeToHandler(
        {},
        makeTaskInfo({ key: 'LOOP-4', labels: ['web-app'] }),
        'jira:issue_created',
        context
      );
      assert.equal(emittedEvents.length, 1);

      // Human types the trigger phrase — must run even though cooling down.
      await routeToHandler(
        {
          comment: {
            body: 'please #agent-detective analyze again, I fixed the labels',
            author: { accountId: 'human-123' },
          },
        },
        makeTaskInfo({ key: 'LOOP-4', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 2, 'comment retry must bypass cooldown');
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

    it('missing-labels comment can be overridden via missingLabelsMessage (keeps placeholder substitution)', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const config: JiraAdapterConfig = {
        missingLabelsMessage: 'Add one of: {available_labels} to {issue_key}, then comment {trigger_phrase}.',
        retryTriggerPhrase: '/analyze-please',
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
      assert.match(
        mockComments[0].text,
        /Add one of: .*web-app.* to TEST-203, then comment \/analyze-please\./
      );
    });
  });

  describe('comment_created → trigger-gated retry', () => {
    function makeCommentPayload(overrides: {
      body: string;
      authorAccountId?: string;
      authorEmail?: string;
    }) {
      return {
        comment: {
          body: overrides.body,
          author: {
            accountId: overrides.authorAccountId ?? 'user-reporter',
            emailAddress: overrides.authorEmail ?? 'reporter@example.com',
          },
        },
      };
    }

    it('trigger phrase + matching label → fans out analysis (same artefacts as create)', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        makeCommentPayload({ body: '#agent-detective analyze please' }),
        makeTaskInfo({ key: 'RETRY-1', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].payload.id, 'RETRY-1:web-app');
      assert.equal(emittedEvents[0].payload.context.repoPath, '/repos/web-app');
      assert.equal(mockComments.length, 0);
    });

    it('trigger phrase matching is case-insensitive and substring-based', async () => {
      registerMatcher([{ name: 'api', path: '/repos/api' }]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        makeCommentPayload({
          body: 'hey, #Agent-Detective ANALYZE now that I added labels — thanks!',
        }),
        makeTaskInfo({ key: 'RETRY-2', labels: ['api'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].payload.metadata.matchedRepo, 'api');
    });

    it('trigger phrase + still no matching label → posts reminder again', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        makeCommentPayload({ body: '#agent-detective analyze' }),
        makeTaskInfo({ key: 'RETRY-3', labels: ['bug'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 1);
      assert.match(mockComments[0].text, /web-app/);
      assert.ok(mockComments[0].text.includes(AGENT_DETECTIVE_MARKER));
    });

    it('comment without trigger phrase → silent (no task, no comment)', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        makeCommentPayload({ body: 'Thanks team, looking into it — standup in 10.' }),
        makeTaskInfo({ key: 'RETRY-4', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 0);
    });

    it('adapter-authored comment (marker present) → silent even if it contains the phrase', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      // Simulate our own result comment being webhooked back to us. The marker
      // is always appended on post, so this is the real shape we'd receive.
      const payload = {
        comment: {
          body: `## Analysis for \`web-app\`\n\nRun \`#agent-detective analyze\` again to re-run.\n\n${AGENT_DETECTIVE_MARKER}`,
          author: {
            accountId: 'bot-account',
            emailAddress: 'bot@example.com',
          },
        },
      };

      await routeToHandler(
        payload,
        makeTaskInfo({ key: 'RETRY-5', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 0);
    });

    it('adapter-authored comment (marker stripped) is still caught by jiraUser accountId fallback', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const config: JiraAdapterConfig = {
        ...analyzeConfig,
        jiraUser: { accountId: 'bot-account', email: 'bot@example.com' },
      };
      const context = createMockContext(config);

      // Marker stripped (e.g. someone edited the comment) but still authored
      // by our API account — loop protection should still hold.
      const payload = {
        comment: {
          body: 'please #agent-detective analyze',
          author: {
            accountId: 'bot-account',
            emailAddress: 'bot@example.com',
          },
        },
      };

      await routeToHandler(
        payload,
        makeTaskInfo({ key: 'RETRY-6', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 0);
    });

    it('comment with ADF body (REST v3) is flattened and matched', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      const adfComment = {
        comment: {
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'labels added, ' },
                  { type: 'text', text: '#agent-detective analyze' },
                ],
              },
            ],
          },
          author: { accountId: 'reporter', emailAddress: 'r@ex.com' },
        },
      };

      await routeToHandler(
        adfComment,
        makeTaskInfo({ key: 'RETRY-7', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].payload.metadata.matchedRepo, 'web-app');
    });

    it('custom retryTriggerPhrase is honored (and default phrase no longer triggers)', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const config: JiraAdapterConfig = {
        ...analyzeConfig,
        retryTriggerPhrase: '/rerun',
      };
      const context = createMockContext(config);

      await routeToHandler(
        makeCommentPayload({ body: '#agent-detective analyze' }),
        makeTaskInfo({ key: 'RETRY-8', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );
      assert.equal(emittedEvents.length, 0);

      await routeToHandler(
        makeCommentPayload({ body: 'go /rerun now please' }),
        makeTaskInfo({ key: 'RETRY-9', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );
      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].payload.id, 'RETRY-9:web-app');
    });

    it('payload without an extractable comment object → silent', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        { issue: { key: 'RETRY-10' } },
        makeTaskInfo({ key: 'RETRY-10', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 0);
    });
  });

  describe('comment_created → PR workflow', () => {
    function makePrPayload(body: string) {
      return {
        comment: {
          body,
          author: { accountId: 'user-reporter', emailAddress: 'reporter@example.com' },
        },
      };
    }

    it('pr trigger phrase + matching label → calls PrWorkflowService, no analysis tasks', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const prCalls: PrWorkflowInput[] = [];
      const mockPr: PrWorkflowService = {
        startPrWorkflow(input: PrWorkflowInput) {
          prCalls.push(input);
        },
      };
      services.set(PR_WORKFLOW_SERVICE, mockPr);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        makePrPayload(
          '#agent-detective pr this error is related to authentication.php in commit 751b957'
        ),
        makeTaskInfo({ key: 'PR-1', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(prCalls.length, 1);
      assert.equal(prCalls[0].issueKey, 'PR-1');
      assert.equal(prCalls[0].match.name, 'web-app');
      assert.equal(prCalls[0].match.path, '/repos/web-app');
      assert.equal(
        prCalls[0].prCommentContext,
        'this error is related to authentication.php in commit 751b957'
      );
    });

    it('pr trigger without pr-pipeline service → posts install hint', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        makePrPayload('#agent-detective pr'),
        makeTaskInfo({ key: 'PR-2', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 1);
      assert.match(mockComments[0].text, /pr-pipeline/);
    });

    it('both pr and analyze phrases in comment → PR wins (no analysis task)', async () => {
      registerMatcher([{ name: 'api', path: '/repos/api' }]);
      const prCalls: PrWorkflowInput[] = [];
      const mockPr: PrWorkflowService = {
        startPrWorkflow(input: PrWorkflowInput) {
          prCalls.push(input);
        },
      };
      services.set(PR_WORKFLOW_SERVICE, mockPr);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        makePrPayload('#agent-detective pr and #agent-detective analyze'),
        makeTaskInfo({ key: 'PR-3', labels: ['api'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 0);
      assert.equal(prCalls.length, 1);
    });

    it('pr trigger + no matching label → missing-labels reminder, no startPrWorkflow', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      const prCalls: PrWorkflowInput[] = [];
      const mockPr: PrWorkflowService = {
        startPrWorkflow(input: PrWorkflowInput) {
          prCalls.push(input);
        },
      };
      services.set(PR_WORKFLOW_SERVICE, mockPr);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        makePrPayload('#agent-detective pr'),
        makeTaskInfo({ key: 'PR-4', labels: ['bug'] }),
        'jira:comment_created',
        context
      );

      assert.equal(prCalls.length, 0);
      assert.equal(emittedEvents.length, 0);
      assert.equal(mockComments.length, 1);
      assert.match(mockComments[0].text, /web-app/);
    });
  });

  describe('multi-repo fan-out', () => {
    it('create + multiple matches → one task per repo with distinct ids, one ack comment', async () => {
      registerMatcher([
        { name: 'api', path: '/repos/api' },
        { name: 'web-app', path: '/repos/web-app' },
        { name: 'mobile-app', path: '/repos/mobile-app' },
      ]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        {},
        makeTaskInfo({ key: 'MULTI-1', labels: ['bug', 'web-app', 'api'] }),
        'jira:issue_created',
        context
      );

      assert.equal(emittedEvents.length, 2);
      const ids = emittedEvents.map((e) => e.payload.id);
      assert.deepEqual(ids, ['MULTI-1:api', 'MULTI-1:web-app']);
      for (const ev of emittedEvents) {
        assert.equal(ev.payload.replyTo.id, 'MULTI-1');
      }

      assert.equal(mockComments.length, 1);
      assert.match(mockComments[0].text, /Analyzing this issue across 2 repositories/);
      assert.match(mockComments[0].text, /`api`/);
      assert.match(mockComments[0].text, /`web-app`/);
      assert.ok(mockComments[0].text.includes(AGENT_DETECTIVE_MARKER));
    });

    it('comment-retry + multiple matches → same fan-out semantics as create', async () => {
      registerMatcher([
        { name: 'api', path: '/repos/api' },
        { name: 'web-app', path: '/repos/web-app' },
      ]);
      const context = createMockContext(analyzeConfig);

      await routeToHandler(
        {
          comment: {
            body: '#agent-detective analyze',
            author: { accountId: 'reporter', emailAddress: 'r@ex.com' },
          },
        },
        makeTaskInfo({ key: 'MULTI-2', labels: ['api', 'web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(emittedEvents.length, 2);
      assert.deepEqual(
        emittedEvents.map((e) => e.payload.id),
        ['MULTI-2:api', 'MULTI-2:web-app']
      );
      assert.equal(mockComments.length, 1);
      assert.match(mockComments[0].text, /Analyzing this issue across 2 repositories/);
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

    it('maxReposPerIssue=0 disables the cap (analyzes all matches)', async () => {
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
      assert.equal(mockComments.length, 1);
      assert.doesNotMatch(mockComments[0].text, /maxReposPerIssue/);
    });
  });

  describe('PR workflow + fetchIssueComments', () => {
    function makePrPayload(body: string) {
      return {
        comment: {
          body,
          author: { accountId: 'user-reporter', emailAddress: 'reporter@example.com' },
        },
      };
    }

    it('fetchIssueComments:true passes human comments to startPrWorkflow', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      mockIssueComments = [
        { text: 'Please fix the login bug', createdAt: '2026-04-01T10:00:00Z', author: { displayName: 'Alice', accountId: 'alice-id' } },
        { text: 'Also check the signup form', createdAt: '2026-04-02T10:00:00Z', author: { displayName: 'Bob', accountId: 'bob-id' } },
      ];
      const prCalls: PrWorkflowInput[] = [];
      services.set(PR_WORKFLOW_SERVICE, {
        startPrWorkflow: (i: PrWorkflowInput) => {
          prCalls.push(i);
        },
      } as PrWorkflowService);
      const config: JiraAdapterConfig = {
        ...analyzeConfig,
        fetchIssueComments: true,
      };
      const context = createMockContext(config);

      await routeToHandler(
        makePrPayload('#agent-detective pr'),
        makeTaskInfo({ key: 'FIC-1', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(prCalls.length, 1);
      assert.ok(Array.isArray(prCalls[0].issueComments));
      assert.equal(prCalls[0].issueComments!.length, 2);
      assert.ok(prCalls[0].issueComments![0].includes('Alice'));
      assert.ok(prCalls[0].issueComments![1].includes('Bob'));
    });

    it('fetchIssueComments:true filters out app-authored comments by marker', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      mockIssueComments = [
        { text: `Human comment`, createdAt: '2026-04-01T10:00:00Z', author: { displayName: 'Alice' } },
        { text: `Bot result\n\n---\n_— Posted by ${AGENT_DETECTIVE_MARKER}_`, createdAt: '2026-04-02T10:00:00Z', author: { displayName: 'Bot' } },
      ];
      const prCalls: PrWorkflowInput[] = [];
      services.set(PR_WORKFLOW_SERVICE, {
        startPrWorkflow: (i: PrWorkflowInput) => {
          prCalls.push(i);
        },
      } as PrWorkflowService);
      const config: JiraAdapterConfig = { ...analyzeConfig, fetchIssueComments: true };
      const context = createMockContext(config);

      await routeToHandler(
        makePrPayload('#agent-detective pr'),
        makeTaskInfo({ key: 'FIC-2', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(prCalls.length, 1);
      assert.equal(prCalls[0].issueComments!.length, 1);
      assert.ok(prCalls[0].issueComments![0].includes('Alice'));
    });

    it('fetchIssueComments:false (default) does not pass issueComments to startPrWorkflow', async () => {
      registerMatcher([{ name: 'web-app', path: '/repos/web-app' }]);
      mockIssueComments = [
        { text: 'Some comment', createdAt: '2026-04-01T10:00:00Z', author: { displayName: 'Alice' } },
      ];
      const prCalls: PrWorkflowInput[] = [];
      services.set(PR_WORKFLOW_SERVICE, {
        startPrWorkflow: (i: PrWorkflowInput) => {
          prCalls.push(i);
        },
      } as PrWorkflowService);
      const context = createMockContext(analyzeConfig); // fetchIssueComments not set → defaults to false

      await routeToHandler(
        makePrPayload('#agent-detective pr'),
        makeTaskInfo({ key: 'FIC-3', labels: ['web-app'] }),
        'jira:comment_created',
        context
      );

      assert.equal(prCalls.length, 1);
      assert.equal(prCalls[0].issueComments, undefined);
    });
  });
});
