import {
  PR_WORKFLOW_SERVICE,
  StandardEvents,
  REPO_MATCHER_SERVICE,
  type PrWorkflowService,
  type EventBus,
  type Logger,
  type MatchedRepo,
  type RepoMatcher,
} from '@agent-detective/sdk';
import type { LinearAdapterConfig } from './options-schema.js';
import type { LinearEventConfig, LinearTaskInfo } from '../domain/types.js';
import { stampComment } from '../domain/comment-mark.js';
import {
  extractLinearCommentFromWebhook,
  extractIssueIdFromLinearWebhook,
  extraTextOutsideTriggerPhrase,
  hasTriggerPhrase,
  isOwnLinearComment,
} from '../domain/linear-comment-triggers.js';
import { linearCanonicalWebhookEvent } from './resolve-linear-event.js';
import type { LinearGraph } from '../infrastructure/linear-graph.js';
import { postMissingLabelsComment } from './missing-labels-linear.js';

const recentMissingLabelsReminders = new Map<string, number>();
const recentAnalysisRuns = new Map<string, number>();

export function __resetLinearHandlerStateForTests(): void {
  recentMissingLabelsReminders.clear();
  recentAnalysisRuns.clear();
}

function analysisKey(issueKey: string, repoName: string): string {
  return `${issueKey}:${repoName}`;
}

function shouldSkipAutoAnalysis(
  issueKey: string,
  repoName: string,
  now: number,
  windowMs: number
): { skip: boolean; ageMs?: number } {
  const last = recentAnalysisRuns.get(analysisKey(issueKey, repoName));
  if (last !== undefined && now - last < windowMs) {
    return { skip: true, ageMs: now - last };
  }
  return { skip: false };
}

function recordAnalysisRun(issueKey: string, repoName: string, now: number, windowMs: number): void {
  recentAnalysisRuns.set(analysisKey(issueKey, repoName), now);
  for (const [key, ts] of recentAnalysisRuns) {
    if (now - ts > windowMs * 3) recentAnalysisRuns.delete(key);
  }
}

function shouldPostReminder(issueKey: string, now: number, windowMs: number): boolean {
  const last = recentMissingLabelsReminders.get(issueKey);
  if (last !== undefined && now - last < windowMs) return false;
  return true;
}

function recordReminderPosted(issueKey: string, now: number, windowMs: number): void {
  recentMissingLabelsReminders.set(issueKey, now);
  for (const [key, ts] of recentMissingLabelsReminders) {
    if (now - ts > windowMs * 10) recentMissingLabelsReminders.delete(key);
  }
}

export function buildLinearIssueRepoTaskId(issueKey: string, repoName: string): string {
  return `${issueKey}:${repoName}`;
}

export interface LinearHandlerContext {
  linearGraph: LinearGraph;
  config: LinearAdapterConfig;
  events: EventBus;
  logger?: Logger;
  getService?: <T>(name: string) => T | null;
}

function getEventConfig(webhookEvent: string, config: LinearAdapterConfig): LinearEventConfig {
  const behavior = config.webhookBehavior;
  if (!behavior) return { action: 'ignore' };
  const eventConfig = behavior.events?.[webhookEvent];
  if (eventConfig) {
    return {
      ...behavior.defaults,
      ...eventConfig,
    };
  }
  return behavior.defaults || { action: 'ignore' };
}

export async function routeLinearWebhook(
  rawBody: Record<string, unknown>,
  context: LinearHandlerContext
): Promise<void> {
  const { config, linearGraph, logger } = context;
  const type = rawBody.type;
  const action = rawBody.action;
  const canonical = linearCanonicalWebhookEvent(type, action);
  const eventConfig = getEventConfig(canonical, config);

  switch (eventConfig.action) {
    case 'analyze':
      await handleAnalyze(rawBody, canonical, context, eventConfig);
      return;
    case 'acknowledge': {
      const issueId = extractIssueIdFromLinearWebhook(rawBody);
      if (!issueId) {
        logger?.warn('linear-adapter: acknowledge skipped — could not resolve issue id from payload');
        return;
      }
      const taskInfo = await linearGraph.fetchIssue(issueId);
      const msg = eventConfig.acknowledgmentMessage || 'Thanks for the update!';
      logger?.info(`linear-adapter: acknowledging ${taskInfo.key}`);
      await linearGraph.addIssueComment(taskInfo.issueUuid, msg);
      return;
    }
    case 'ignore':
    default:
      logger?.debug?.(`linear-adapter: ignored webhook ${canonical}`);
      return;
  }
}

type CommentMode = 'none' | 'pr' | 'analyze';

function getCommentMode(
  rawBody: Record<string, unknown>,
  config: LinearAdapterConfig,
  logger: Logger | undefined,
  issueKey: string
): CommentMode {
  const comment = extractLinearCommentFromWebhook(rawBody);
  if (!comment) {
    logger?.debug?.(`linear-adapter: ${issueKey} comment webhook had no extractable body — no trigger`);
    return 'none';
  }
  if (isOwnLinearComment(comment.body, comment.actorId, config.botActorIds)) {
    logger?.debug?.(`linear-adapter: ${issueKey} comment is adapter/bot-authored — ignoring`);
    return 'none';
  }
  if (hasTriggerPhrase(comment.body, config.prTriggerPhrase)) {
    logger?.info(`linear-adapter: ${issueKey} prTriggerPhrase matched — PR workflow`);
    return 'pr';
  }
  if (hasTriggerPhrase(comment.body, config.retryTriggerPhrase)) {
    logger?.info(`linear-adapter: ${issueKey} retryTriggerPhrase matched — analyze`);
    return 'analyze';
  }
  logger?.debug?.(`linear-adapter: ${issueKey} comment did not match trigger phrases`);
  return 'none';
}

async function handleAnalyze(
  rawBody: Record<string, unknown>,
  canonical: string,
  context: LinearHandlerContext,
  eventConfig: LinearEventConfig
): Promise<void> {
  const { config, linearGraph, logger, getService } = context;
  const matcher = getService?.<RepoMatcher>(REPO_MATCHER_SERVICE) ?? null;
  if (!matcher) {
    logger?.warn('linear-adapter: no RepoMatcher — cannot resolve labels; skipping analyze');
    return;
  }

  const issueUuid = extractIssueIdFromLinearWebhook(rawBody);
  if (!issueUuid) {
    logger?.warn('linear-adapter: analyze skipped — missing issue id on payload');
    return;
  }

  const taskInfo = await linearGraph.fetchIssue(issueUuid);

  const isIssueCreate = canonical === 'linear:Issue:create';
  const isCommentCreate = canonical === 'linear:Comment:create';
  let linearReplyParentId: string | undefined;

  if (isCommentCreate) {
    const mode = getCommentMode(rawBody, config, logger, taskInfo.key);
    if (mode === 'none') return;
    if (mode === 'pr') {
      const repos = matcher.matchAllByLabels(taskInfo.labels);
      if (repos.length === 0) {
        await postMissingWithRateLimit(taskInfo, matcher, context);
        return;
      }
      const comment = extractLinearCommentFromWebhook(rawBody);
      const prCommentContext = comment?.body
        ? extraTextOutsideTriggerPhrase(comment.body, config.prTriggerPhrase)
        : '';
      await fanOutPr(repos, taskInfo, context, eventConfig, prCommentContext, comment?.id);
      return;
    }
    const comment = extractLinearCommentFromWebhook(rawBody);
    linearReplyParentId = comment?.id;
  } else if (!isIssueCreate) {
    logger?.debug?.(`linear-adapter: ${taskInfo.key} (${canonical}) routed to analyze via custom config`);
  }

  const reposToAnalyze = matcher.matchAllByLabels(taskInfo.labels);
  if (reposToAnalyze.length === 0) {
    if (isIssueCreate || isCommentCreate) {
      await postMissingWithRateLimit(taskInfo, matcher, context, { replyParentCommentId: linearReplyParentId });
    } else {
      logger?.debug?.(`linear-adapter: ${taskInfo.key} (${canonical}) has no matching label — silent`);
    }
    return;
  }

  await fanOutAnalysis(reposToAnalyze, taskInfo, context, eventConfig, {
    bypassCooldown: isCommentCreate,
    linearReplyParentId,
  });
}

async function postMissingWithRateLimit(
  taskInfo: LinearTaskInfo,
  matcher: RepoMatcher,
  context: LinearHandlerContext,
  options?: { replyParentCommentId?: string }
): Promise<void> {
  const { config, linearGraph, logger } = context;
  const now = Date.now();
  const win = config.missingLabelsReminderCooldownMs;
  if (!shouldPostReminder(taskInfo.key, now, win)) {
    logger?.warn(`linear-adapter: suppressing duplicate missing-labels reminder for ${taskInfo.key}`);
    return;
  }
  await postMissingLabelsComment(taskInfo, matcher.listConfiguredLabels(), {
    graph: linearGraph,
    messageTemplate: config.missingLabelsMessage,
    triggerPhrase: config.retryTriggerPhrase,
    logger,
    replyParentCommentId: options?.replyParentCommentId,
  });
  recordReminderPosted(taskInfo.key, now, win);
}

async function fanOutAnalysis(
  currentMatches: readonly MatchedRepo[],
  taskInfo: LinearTaskInfo,
  context: LinearHandlerContext,
  eventConfig: LinearEventConfig,
  options: { bypassCooldown?: boolean; linearReplyParentId?: string } = {}
): Promise<void> {
  const { config, linearGraph, events, logger } = context;

  let reposToAnalyze: MatchedRepo[] = [...currentMatches];
  const cap = config.maxReposPerIssue;
  let skippedByCap: MatchedRepo[] = [];
  if (cap > 0 && reposToAnalyze.length > cap) {
    skippedByCap = reposToAnalyze.slice(cap);
    reposToAnalyze = reposToAnalyze.slice(0, cap);
    logger?.warn(
      `linear-adapter: ${taskInfo.key} matched ${reposToAnalyze.length + skippedByCap.length} repos but maxReposPerIssue=${cap}`
    );
  }

  if (!options.bypassCooldown) {
    const now = Date.now();
    const cd = config.autoAnalysisCooldownMs;
    const skippedByCooldown: MatchedRepo[] = [];
    const allowed: MatchedRepo[] = [];
    for (const repo of reposToAnalyze) {
      const check = shouldSkipAutoAnalysis(taskInfo.key, repo.name, now, cd);
      if (check.skip) {
        skippedByCooldown.push(repo);
        logger?.warn(`linear-adapter: suppressing auto-analysis of ${taskInfo.key}:${repo.name} (cooldown)`);
      } else {
        allowed.push(repo);
      }
    }
    if (skippedByCooldown.length > 0 && allowed.length === 0) return;
    reposToAnalyze = allowed;
  }

  if (reposToAnalyze.length > 1 || skippedByCap.length > 0) {
    try {
      await linearGraph.addIssueComment(
        taskInfo.issueUuid,
        stampComment(buildFanOutAckMessage(reposToAnalyze, skippedByCap)),
        options.linearReplyParentId ? { parentId: options.linearReplyParentId } : undefined
      );
    } catch (err) {
      logger?.warn(`linear-adapter: fan-out ack failed for ${taskInfo.key}: ${(err as Error).message}`);
    }
  }

  const readOnly = config.analysisReadOnly !== false;
  const now = Date.now();
  const cd = config.autoAnalysisCooldownMs;

  for (const match of reposToAnalyze) {
    if (!options.bypassCooldown) {
      recordAnalysisRun(taskInfo.key, match.name, now, cd);
    }
    events.emit(StandardEvents.TASK_CREATED, {
      id: buildLinearIssueRepoTaskId(taskInfo.key, match.name),
      type: 'incident',
      source: '@agent-detective/linear-adapter',
      message: taskInfo.description || taskInfo.summary,
      context: {
        repoPath: match.path,
        threadId: null,
        cwd: match.path,
      },
      replyTo: {
        type: 'issue',
        id: taskInfo.issueUuid,
      },
      metadata: {
        labels: taskInfo.labels,
        projectKey: taskInfo.projectKey,
        requiresCodeContext: true,
        analysisPrompt: eventConfig.analysisPrompt || config.analysisPrompt,
        readOnly,
        matchedRepo: match.name,
        linearIssueKey: taskInfo.key,
        ...(options.linearReplyParentId ? { linearReplyParentId: options.linearReplyParentId } : {}),
      },
    });
  }
}

function buildFanOutAckMessage(analyzed: readonly MatchedRepo[], skipped: readonly MatchedRepo[]): string {
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
      } skipped to stay within the \`maxReposPerIssue\` safety cap: ${skippedList}.`
    );
  }
  return lines.join('\n');
}

function actorIdFromLinearActorKey(actorKey: string): string | undefined {
  if (actorKey.startsWith('user:')) return actorKey.slice(5);
  if (actorKey.startsWith('bot:')) return actorKey.slice(4);
  return undefined;
}

async function fanOutPr(
  currentMatches: readonly MatchedRepo[],
  taskInfo: LinearTaskInfo,
  context: LinearHandlerContext,
  eventConfig: LinearEventConfig,
  prCommentContext: string,
  triggerCommentId?: string
): Promise<void> {
  const { config, linearGraph, logger, getService } = context;

  let repos = [...currentMatches];
  const cap = config.maxReposPerIssue;
  let skippedByCap: MatchedRepo[] = [];
  if (cap > 0 && repos.length > cap) {
    skippedByCap = repos.slice(cap);
    repos = repos.slice(0, cap);
  }

  const prThreadOpts = triggerCommentId ? { parentId: triggerCommentId } : undefined;

  if (repos.length > 1 || skippedByCap.length > 0) {
    try {
      await linearGraph.addIssueComment(
        taskInfo.issueUuid,
        stampComment(
          `Starting **PR** workflow for: ${repos.map((r) => `\`${r.name}\``).join(', ')}. ` +
            (skippedByCap.length ? `Skipped by cap: ${skippedByCap.map((r) => r.name).join(', ')}.` : '')
        ),
        prThreadOpts
      );
    } catch (err) {
      logger?.warn(`linear-adapter: fanOutPr ack failed: ${(err as Error).message}`);
    }
  }

  const pr = getService?.<PrWorkflowService>(PR_WORKFLOW_SERVICE) ?? null;
  if (!pr) {
    await linearGraph.addIssueComment(
      taskInfo.issueUuid,
      stampComment(
        '**pr-pipeline** is not loaded. Add `@agent-detective/pr-pipeline` to `plugins` in config to enable PR creation from Linear.'
      ),
      prThreadOpts
    );
    return;
  }

  let issueComments: string[] | undefined;
  if (config.fetchIssueComments) {
    try {
      const allComments = await linearGraph.listCommentsForPr(taskInfo.issueUuid);
      const prPhrase = config.prTriggerPhrase;
      const analyzePhrase = config.retryTriggerPhrase;
      issueComments = allComments
        .filter((c) => {
          const actorId = actorIdFromLinearActorKey(c.actorKey);
          if (isOwnLinearComment(c.text, actorId, config.botActorIds)) return false;
          if (hasTriggerPhrase(c.text, prPhrase)) return false;
          if (hasTriggerPhrase(c.text, analyzePhrase)) return false;
          return true;
        })
        .map((c) => {
          const who = c.actorKey;
          const text = c.text.slice(0, 2_000);
          return `[${c.createdAt}] ${who}:\n${text}`;
        })
        .slice(-30);
    } catch (err) {
      logger?.warn(`linear-adapter: failed to fetch comments for ${taskInfo.key}: ${(err as Error).message}`);
    }
  }

  let imageAttachments: Array<{ id: string; filename: string; mimeType: string; size: number }> | undefined;
  try {
    const attachments = await linearGraph.listImageAttachments(taskInfo.issueUuid);
    if (attachments.length > 0) {
      imageAttachments = attachments;
      logger?.info(`linear-adapter: found ${attachments.length} image attachment(s) for ${taskInfo.key}`);
    }
  } catch (err) {
    logger?.warn(`linear-adapter: failed to fetch attachments for ${taskInfo.key}: ${(err as Error).message}`);
  }

  for (const match of repos) {
    pr.startPrWorkflow({
      issueKey: taskInfo.issueUuid,
      issueSummary: taskInfo.summary,
      taskDescription: taskInfo.description,
      projectKey: taskInfo.projectKey,
      labels: taskInfo.labels,
      match: { name: match.name, path: match.path },
      issueTracker: {
        addComment: async (issueId, text, opts) => {
          await linearGraph.addIssueComment(issueId, text, opts?.parentId ? { parentId: opts.parentId } : undefined);
        },
        downloadAttachment: (id) => linearGraph.downloadAttachment(id),
      },
      analysisPrompt: eventConfig.analysisPrompt || config.analysisPrompt,
      ...(prCommentContext ? { prCommentContext } : {}),
      ...(issueComments?.length ? { issueComments } : {}),
      ...(triggerCommentId ? { triggerCommentId } : {}),
      ...(imageAttachments?.length ? { imageAttachments } : {}),
    });
  }
}
