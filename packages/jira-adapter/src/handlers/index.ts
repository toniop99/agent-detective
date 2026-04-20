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
import { extractAddedLabelsFromChangelog, extractLabelsBeforeUpdate } from '../changelog.js';

const DEFAULT_MAX_REPOS_PER_ISSUE = 5;

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
      };
      const message = eventConfig.acknowledgmentMessage || getDefaultAcknowledgmentMessage();
      await handleAcknowledge(taskInfo, message, acknowledgeDeps);
      return;
    }

    case 'ignore':
    default: {
      const ignoreDeps: IgnoreHandlerDeps = {
        webhookEvent,
      };
      await handleIgnore(taskInfo, ignoreDeps);
      return;
    }
  }
}

/**
 * Core of the label-only, multi-repo flow:
 *
 *   - `jira:issue_created`: match labels → emit one analysis task per matched
 *     repo (capped by `maxReposPerIssue`), or post the "please add a matching
 *     tag" comment once when nothing matches.
 *   - `jira:issue_updated`: only act if the changelog added labels. For each
 *     currently-matched repo, emit an analysis task **only if that specific
 *     repo wasn't already matched before this update** (per-repo delta dedup
 *     prevents re-analyzing repos we've already looked at).
 *   - Unknown / other events under the `analyze` action: fall back to "match
 *     or stay silent" with no comment, since we have no create/update
 *     semantics to lean on.
 *
 * If the `RepoMatcher` service isn't registered we cannot make a deterministic
 * decision; we log and skip rather than guess.
 */
async function handleAnalyze(
  rawPayload: unknown,
  taskInfo: JiraTaskInfo,
  webhookEvent: string,
  context: HandlerContext,
  eventConfig: JiraEventConfig
): Promise<void> {
  const { config, jiraClient, events, logger, getService } = context;

  const matcher = getService?.<RepoMatcher>(REPO_MATCHER_SERVICE) ?? null;
  if (!matcher) {
    logger?.warn(
      `jira-adapter: no RepoMatcher service registered — cannot resolve labels for ${taskInfo.key}; skipping analyze.`
    );
    return;
  }

  const normalizedEvent = webhookEvent.toLowerCase();
  const isUpdate = normalizedEvent === 'jira:issue_updated';
  const isCreate = normalizedEvent === 'jira:issue_created';

  const currentMatches = matcher.matchAllByLabels(taskInfo.labels);

  // Determine which of the currently-matched repos actually need analysis.
  // On update we fan out only to repos that are newly matched *by this change*.
  let reposToAnalyze: MatchedRepo[];
  if (isUpdate) {
    const addedLabels = extractAddedLabelsFromChangelog(rawPayload);
    if (addedLabels.length === 0) {
      logger?.debug?.(
        `jira-adapter: ${taskInfo.key} update had no label additions — staying silent.`
      );
      return;
    }
    if (currentMatches.length === 0) {
      logger?.debug?.(
        `jira-adapter: ${taskInfo.key} update added labels [${addedLabels.join(', ')}] but none match a configured repo — staying silent.`
      );
      return;
    }
    // Per-repo delta dedup: skip any repo that was already matched by labels
    // present *before* this update (we've already analyzed that repo on a
    // previous create or label-add).
    const previousMatches = matcher.matchAllByLabels(extractLabelsBeforeUpdate(rawPayload));
    const previousNames = new Set(previousMatches.map((r) => r.name.toLowerCase()));
    reposToAnalyze = currentMatches.filter((r) => !previousNames.has(r.name.toLowerCase()));

    if (reposToAnalyze.length === 0) {
      logger?.info(
        `jira-adapter: ${taskInfo.key} update touched labels but all matched repos [${currentMatches
          .map((r) => r.name)
          .join(', ')}] were already matched before — skipping re-analysis.`
      );
      return;
    }
    logger?.info(
      `jira-adapter: ${taskInfo.key} update added repos [${reposToAnalyze
        .map((r) => r.name)
        .join(', ')}] → fan-out analysis.`
    );
  } else {
    if (currentMatches.length === 0) {
      if (isCreate) {
        await handleMissingLabels(taskInfo, matcher.listConfiguredLabels(), {
          jiraClient,
          messageTemplate: config.missingLabelsMessage,
        });
      } else {
        logger?.debug?.(
          `jira-adapter: ${taskInfo.key} (${webhookEvent}) has no matching label — staying silent.`
        );
      }
      return;
    }
    reposToAnalyze = currentMatches;
  }

  // Enforce the fan-out safety cap. `0` disables the cap.
  const cap = config.maxReposPerIssue ?? DEFAULT_MAX_REPOS_PER_ISSUE;
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

  // Single acknowledgment summarizing the fan-out (only when more than one
  // repo will actually run — a single-repo analysis speaks for itself).
  if (reposToAnalyze.length > 1 || skippedByCap.length > 0) {
    try {
      await jiraClient.addComment(
        taskInfo.key,
        buildFanOutAckMessage(reposToAnalyze, skippedByCap)
      );
    } catch (err) {
      logger?.warn(
        `jira-adapter: failed to post fan-out acknowledgment for ${taskInfo.key}: ${(err as Error).message}`
      );
    }
  }

  const readOnly = config.analysisReadOnly !== false;

  for (const match of reposToAnalyze) {
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
