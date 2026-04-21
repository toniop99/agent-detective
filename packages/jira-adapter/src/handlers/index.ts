import {
  StandardEvents,
  REPO_MATCHER_SERVICE,
  type EventBus,
  type Logger,
  type MatchedRepo,
  type RepoMatcher,
} from '@agent-detective/types';
import type { JiraAdapterConfig, JiraWebhookEventType, JiraEventConfig, JiraTaskInfo } from '../types.js';
import { getDefaultAcknowledgmentMessage } from '../types.js';
import { handleAcknowledge, AcknowledgeHandlerDeps } from './acknowledge-handler.js';
import { handleIgnore, IgnoreHandlerDeps } from './ignore-handler.js';
import { handleMissingLabels } from './missing-labels-handler.js';
import {
  extractCommentInfo,
  hasTriggerPhrase,
  isOwnComment,
  stampComment,
} from '../comment-trigger.js';
import { jiraAdapterOptionsSchema } from '../options-schema.js';

/** Options defaults from the Zod schema (single source of truth for handler fallbacks). */
const jiraHandlerDefaults = jiraAdapterOptionsSchema.parse({});

/**
 * Last line of defense against a webhook-echo loop: once we post a
 * missing-labels reminder for an issue, we refuse to post another for the
 * same issue within this window, regardless of what the comment-trigger
 * plumbing says.
 *
 * The primary loop protection is `isOwnComment` + the visible marker
 * footer in `comment-trigger.ts`. This rate-limit kicks in only when that
 * primary protection fails — e.g. a Jira edition that re-serializes our
 * ADF in a way that drops the marker text, or an operator-edited reminder
 * template that strips the footer. 60s is small enough that a user
 * legitimately adding + re-commenting in quick succession still works the
 * second time around, but orders of magnitude larger than the webhook
 * round-trip that drives the pathological loop.
 */
const recentMissingLabelsReminders = new Map<string, number>();

/**
 * Per-(issue, repo) cooldown for **automatic** (non-comment-triggered)
 * analysis. The reason this exists:
 *
 * Jira Automation rules commonly fire on both "issue created" *and*
 * "issue updated", and posting a comment updates the issue from Jira's
 * perspective. Unless the operator carefully scopes the rule, the
 * adapter's own result comments can trigger another webhook that — if
 * our payload-shape classifier misidentifies it as `issue_created` —
 * re-runs analysis and appends another comment, which fires another
 * webhook, and so on. Payload-shape classification is the primary
 * defense (see `detectChangelogActivity`), but as a last-resort circuit
 * breaker we refuse to auto-analyze the same `(issueKey, repoName)` pair
 * more than once per window.
 *
 * Explicit `jira:comment_created` retries **do not** consult this window:
 * when a human types the trigger phrase, they are explicitly asking for
 * a fresh run and shouldn't be silently suppressed.
 *
 * 10 minutes is small enough that real follow-up analyses (e.g. you
 * re-tag an issue later the same day) still fire, but orders of
 * magnitude larger than the webhook round-trip that causes the loop.
 */
const recentAnalysisRuns = new Map<string, number>();

function analysisKey(issueKey: string, repoName: string): string {
  return `${issueKey}:${repoName}`;
}

function shouldSkipAutoAnalysis(
  issueKey: string,
  repoName: string,
  now: number,
  config: JiraAdapterConfig
): { skip: boolean; ageMs?: number } {
  const windowMs = config.autoAnalysisCooldownMs ?? jiraHandlerDefaults.autoAnalysisCooldownMs;
  const last = recentAnalysisRuns.get(analysisKey(issueKey, repoName));
  if (last !== undefined && now - last < windowMs) {
    return { skip: true, ageMs: now - last };
  }
  return { skip: false };
}

function recordAnalysisRun(
  issueKey: string,
  repoName: string,
  now: number,
  config: JiraAdapterConfig
): void {
  const windowMs = config.autoAnalysisCooldownMs ?? jiraHandlerDefaults.autoAnalysisCooldownMs;
  recentAnalysisRuns.set(analysisKey(issueKey, repoName), now);
  for (const [key, ts] of recentAnalysisRuns) {
    if (now - ts > windowMs * 3) recentAnalysisRuns.delete(key);
  }
}

function shouldPostReminder(issueKey: string, now: number, config: JiraAdapterConfig): boolean {
  const windowMs = config.missingLabelsReminderCooldownMs ?? jiraHandlerDefaults.missingLabelsReminderCooldownMs;
  const last = recentMissingLabelsReminders.get(issueKey);
  if (last !== undefined && now - last < windowMs) {
    return false;
  }
  return true;
}

function recordReminderPosted(issueKey: string, now: number, config: JiraAdapterConfig): void {
  const windowMs = config.missingLabelsReminderCooldownMs ?? jiraHandlerDefaults.missingLabelsReminderCooldownMs;
  recentMissingLabelsReminders.set(issueKey, now);
  // Opportunistic GC so the map doesn't grow forever in long-lived processes.
  for (const [key, ts] of recentMissingLabelsReminders) {
    if (now - ts > windowMs * 10) {
      recentMissingLabelsReminders.delete(key);
    }
  }
}

/** Test-only escape hatch. Not exported from the package index. */
export function __resetMissingLabelsReminderStateForTests(): void {
  recentMissingLabelsReminders.clear();
}

/** Test-only escape hatch. Not exported from the package index. */
export function __resetAnalysisCooldownForTests(): void {
  recentAnalysisRuns.clear();
}

/** Stable task id for a single (issue, repo) pair. Orchestrator uses this as the queue key. */
export function buildIssueRepoTaskId(issueKey: string, repoName: string): string {
  return `${issueKey}:${repoName}`;
}

export interface HandlerContext {
  jiraClient: AcknowledgeHandlerDeps['jiraClient'];
  config: JiraAdapterConfig;
  events: EventBus;
  logger?: Logger;
  /**
   * Optional service-lookup fn. Wired in `jira-adapter/src/index.ts` from the
   * plugin `context.getService`. Returns `null` when the service isn't
   * registered instead of throwing, so handlers can degrade gracefully (e.g.
   * if no `RepoMatcher` is configured yet, analysis falls back to the old
   * unconditional behavior).
   */
  getService?: <T>(name: string) => T | null;
}

function getEventConfig(
  webhookEvent: string,
  config: JiraAdapterConfig
): JiraEventConfig {
  const behavior = config.webhookBehavior;
  if (!behavior) {
    return { action: 'ignore' };
  }

  const eventType = webhookEvent as JiraWebhookEventType;
  const eventConfig = behavior.events?.[eventType];

  if (eventConfig) {
    return {
      ...behavior.defaults,
      ...eventConfig,
    };
  }

  return behavior.defaults || { action: 'ignore' };
}

export async function routeToHandler(
  rawPayload: unknown,
  taskInfo: JiraTaskInfo,
  webhookEvent: string,
  context: HandlerContext
): Promise<void> {
  const { config, jiraClient } = context;

  const eventConfig = getEventConfig(webhookEvent, config);

  switch (eventConfig.action) {
    case 'analyze': {
      await handleAnalyze(rawPayload, taskInfo, webhookEvent, context, eventConfig);
      return;
    }

    case 'acknowledge': {
      const acknowledgeDeps: AcknowledgeHandlerDeps = {
        jiraClient,
        config,
        logger: context.logger,
      };
      const message = eventConfig.acknowledgmentMessage || getDefaultAcknowledgmentMessage();
      await handleAcknowledge(taskInfo, message, acknowledgeDeps);
      return;
    }

    case 'ignore':
    default: {
      const ignoreDeps: IgnoreHandlerDeps = {
        webhookEvent,
        logger: context.logger,
      };
      await handleIgnore(taskInfo, ignoreDeps);
      return;
    }
  }
}

/**
 * Core of the label-only, multi-repo flow. Two event types trigger analysis,
 * and everything else under `analyze` is a no-op:
 *
 *   - `jira:issue_created`: match labels → emit one analysis task per matched
 *     repo (capped by `maxReposPerIssue`), or post the "please add a matching
 *     tag + `<trigger>` comment" reminder once when nothing matches.
 *   - `jira:comment_created`: if the comment contains the configured trigger
 *     phrase AND is not adapter-authored, re-run the match against the
 *     issue's CURRENT labels. Matches → fan out. No matches → post the
 *     reminder again (the user explicitly asked).
 *
 * No changelog parsing, no delta dedup, no `issue_updated` retry. The
 * comment trigger is the entire retry mechanism, which keeps the handler
 * stateless and deterministic at the cost of requiring one extra user
 * action after the labels are added.
 *
 * If the `RepoMatcher` service isn't registered we cannot make a
 * deterministic decision; we log and skip rather than guess.
 */
async function handleAnalyze(
  rawPayload: unknown,
  taskInfo: JiraTaskInfo,
  webhookEvent: string,
  context: HandlerContext,
  eventConfig: JiraEventConfig
): Promise<void> {
  const { config, logger, getService } = context;

  const matcher = getService?.<RepoMatcher>(REPO_MATCHER_SERVICE) ?? null;
  if (!matcher) {
    logger?.warn(
      `jira-adapter: no RepoMatcher service registered — cannot resolve labels for ${taskInfo.key}; skipping analyze.`
    );
    return;
  }

  const normalizedEvent = webhookEvent.toLowerCase();
  const isCreate = normalizedEvent === 'jira:issue_created';
  const isCommentCreated = normalizedEvent === 'jira:comment_created';

  if (isCommentCreated) {
    const shouldRun = shouldTreatCommentAsRetry(rawPayload, config, logger, taskInfo.key);
    if (!shouldRun) return;
  } else if (!isCreate) {
    // Any other event routed to `analyze` (e.g. a custom rule pointing
    // `jira:issue_updated` back at analyze) matches on current labels only —
    // no create-specific reminder, no comment-specific gating.
    logger?.debug?.(
      `jira-adapter: ${taskInfo.key} (${webhookEvent}) routed to analyze via custom config — running plain label match.`
    );
  }

  const reposToAnalyze = matcher.matchAllByLabels(taskInfo.labels);

  if (reposToAnalyze.length === 0) {
    // Both create and comment-retry post the reminder on empty match. The
    // comment-retry path re-posts because the user explicitly invoked the
    // trigger — silence there feels broken. Non-create / non-comment events
    // under a custom `analyze` mapping stay silent (we've got no
    // user-initiated signal to justify a comment).
    if (isCreate || isCommentCreated) {
      await postMissingLabelsReminder(taskInfo, matcher, context);
    } else {
      logger?.debug?.(
        `jira-adapter: ${taskInfo.key} (${webhookEvent}) has no matching label — staying silent.`
      );
    }
    return;
  }

  await fanOutAnalysis(reposToAnalyze, taskInfo, context, eventConfig, {
    // Only explicit user comment retries bypass the cooldown. Every other
    // path (issue_created, custom issue_updated→analyze mapping) has to
    // wait out the window for the same (issue, repo) pair.
    bypassCooldown: isCommentCreated,
  });
}

/**
 * Decides whether a `jira:comment_created` event should trigger a retry:
 *
 *   - Comment must be extractable (body present).
 *   - Comment must NOT be adapter-authored (marker or `jiraUser` match).
 *   - Body must contain `retryTriggerPhrase` (case-insensitive substring).
 *
 * Any failure logs at `debug` and returns `false`. Success logs at `info`
 * so operators can confirm the trigger fired against a specific comment.
 */
function shouldTreatCommentAsRetry(
  rawPayload: unknown,
  config: JiraAdapterConfig,
  logger: Logger | undefined,
  issueKey: string
): boolean {
  const comment = extractCommentInfo(rawPayload);
  if (!comment) {
    logger?.debug?.(
      `jira-adapter: ${issueKey} comment_created payload had no extractable comment body — ignoring.`
    );
    return false;
  }

  const ownUser = config.jiraUser;
  if (isOwnComment(comment.body, comment.author, ownUser)) {
    logger?.debug?.(
      `jira-adapter: ${issueKey} comment_created authored by adapter (marker or jiraUser match) — ignoring to avoid loop.`
    );
    return false;
  }

  const phrase = config.retryTriggerPhrase || jiraHandlerDefaults.retryTriggerPhrase;
  if (!hasTriggerPhrase(comment.body, phrase)) {
    logger?.debug?.(
      `jira-adapter: ${issueKey} comment_created does not contain trigger phrase ("${phrase}") — ignoring.`
    );
    return false;
  }

  logger?.info(
    `jira-adapter: ${issueKey} comment_created contains trigger phrase ("${phrase}") — re-running label match.`
  );
  return true;
}

async function postMissingLabelsReminder(
  taskInfo: JiraTaskInfo,
  matcher: RepoMatcher,
  context: HandlerContext
): Promise<void> {
  const { config, jiraClient, logger } = context;
  const now = Date.now();
  if (!shouldPostReminder(taskInfo.key, now, config)) {
    const last = recentMissingLabelsReminders.get(taskInfo.key) ?? now;
    const win =
      config.missingLabelsReminderCooldownMs ?? jiraHandlerDefaults.missingLabelsReminderCooldownMs;
    logger?.warn(
      `jira-adapter: suppressing duplicate missing-labels reminder for ${taskInfo.key} ` +
        `(last posted ${Math.round((now - last) / 1000)}s ago, window=${Math.round(
          win / 1000
        )}s). This usually means a comment_created webhook echoing our own ` +
        `reminder slipped past own-comment detection — check that the reminder ` +
        `comment still renders the "Posted by agent-detective" footer in Jira.`
    );
    return;
  }
  const triggerPhrase = config.retryTriggerPhrase || jiraHandlerDefaults.retryTriggerPhrase;
  await handleMissingLabels(taskInfo, matcher.listConfiguredLabels(), {
    jiraClient,
    messageTemplate: config.missingLabelsMessage,
    triggerPhrase,
    logger,
  });
  recordReminderPosted(taskInfo.key, now, config);
}

/**
 * Emits `TASK_CREATED` once per matched repo (capped by `maxReposPerIssue`)
 * and posts a single fan-out acknowledgment when more than one repo will run
 * or anything was skipped. Shared between the create and comment-retry paths
 * so they produce identical Jira artefacts.
 */
async function fanOutAnalysis(
  currentMatches: readonly MatchedRepo[],
  taskInfo: JiraTaskInfo,
  context: HandlerContext,
  eventConfig: JiraEventConfig,
  options: { bypassCooldown?: boolean } = {}
): Promise<void> {
  const { config, jiraClient, events, logger } = context;

  let reposToAnalyze: MatchedRepo[] = [...currentMatches];
  const cap = config.maxReposPerIssue ?? jiraHandlerDefaults.maxReposPerIssue;
  let skippedByCap: MatchedRepo[] = [];
  if (cap > 0 && reposToAnalyze.length > cap) {
    skippedByCap = reposToAnalyze.slice(cap);
    reposToAnalyze = reposToAnalyze.slice(0, cap);
    logger?.warn(
      `jira-adapter: ${taskInfo.key} matched ${
        reposToAnalyze.length + skippedByCap.length
      } repos but maxReposPerIssue=${cap}; analyzing [${reposToAnalyze
        .map((r) => r.name)
        .join(', ')}], skipping [${skippedByCap.map((r) => r.name).join(', ')}].`
    );
  }

  // Enforce the per-(issue, repo) cooldown for automatic paths. This is
  // the last-ditch loop guard for the case where Jira Automation echoes
  // our own comment-posts back as ambiguously-shaped webhooks that slip
  // past `detectChangelogActivity`. Explicit comment retries bypass this.
  if (!options.bypassCooldown) {
    const now = Date.now();
    const skippedByCooldown: MatchedRepo[] = [];
    const allowed: MatchedRepo[] = [];
    for (const repo of reposToAnalyze) {
      const check = shouldSkipAutoAnalysis(taskInfo.key, repo.name, now, config);
      if (check.skip) {
        skippedByCooldown.push(repo);
        const cd = config.autoAnalysisCooldownMs ?? jiraHandlerDefaults.autoAnalysisCooldownMs;
        logger?.warn(
          `jira-adapter: suppressing auto-analysis of ${taskInfo.key}:${repo.name} ` +
            `(ran ${Math.round((check.ageMs ?? 0) / 1000)}s ago, window=${Math.round(
              cd / 1000
            )}s). This is the circuit breaker for webhook echo loops — if ` +
            `it keeps tripping, check your Jira Automation rule scope and ` +
            `the event classifier log line above. An explicit "` +
            `${config.retryTriggerPhrase || jiraHandlerDefaults.retryTriggerPhrase}" ` +
            `comment bypasses this cooldown.`
        );
      } else {
        allowed.push(repo);
      }
    }
    if (skippedByCooldown.length > 0 && allowed.length === 0) {
      // Every repo was suppressed — nothing to do, and we deliberately
      // stay silent (no acknowledgment comment) so we don't tickle the
      // loop further. The warn above is the only visible side effect.
      return;
    }
    reposToAnalyze = allowed;
  }

  if (reposToAnalyze.length > 1 || skippedByCap.length > 0) {
    try {
      await jiraClient.addComment(
        taskInfo.key,
        stampComment(buildFanOutAckMessage(reposToAnalyze, skippedByCap))
      );
    } catch (err) {
      logger?.warn(
        `jira-adapter: failed to post fan-out acknowledgment for ${taskInfo.key}: ${(err as Error).message}`
      );
    }
  }

  const readOnly = config.analysisReadOnly !== false;
  const now = Date.now();

  for (const match of reposToAnalyze) {
    if (!options.bypassCooldown) {
      recordAnalysisRun(taskInfo.key, match.name, now, config);
    }
    events.emit(StandardEvents.TASK_CREATED, {
      id: buildIssueRepoTaskId(taskInfo.key, match.name),
      type: 'incident',
      source: '@agent-detective/jira-adapter',
      message: taskInfo.description,
      context: {
        repoPath: match.path,
        threadId: null,
        cwd: match.path,
      },
      replyTo: {
        type: 'issue',
        id: taskInfo.key,
      },
      metadata: {
        labels: taskInfo.labels,
        projectKey: taskInfo.projectKey,
        requiresCodeContext: true,
        analysisPrompt: eventConfig.analysisPrompt || config.analysisPrompt,
        readOnly,
        matchedRepo: match.name,
      },
    });
  }
}

function buildFanOutAckMessage(
  analyzed: readonly MatchedRepo[],
  skipped: readonly MatchedRepo[]
): string {
  const analyzedList = analyzed.map((r) => `\`${r.name}\``).join(', ');
  const lines = [
    `Analyzing this issue across ${analyzed.length} repositories: ${analyzedList}. Results will be posted as separate comments below.`,
  ];
  if (skipped.length > 0) {
    const skippedList = skipped.map((r) => `\`${r.name}\``).join(', ');
    lines.push(
      '',
      `**Note:** ${skipped.length} additional matched ${
        skipped.length === 1 ? 'repo was' : 'repos were'
      } skipped to stay within the \`maxReposPerIssue\` safety cap: ${skippedList}. Remove an unrelated label or raise the cap if you need them analyzed.`
    );
  }
  return lines.join('\n');
}
