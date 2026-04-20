import {
  StandardEvents,
  REPO_MATCHER_SERVICE,
  type EventBus,
  type Logger,
  type RepoMatcher,
} from '@agent-detective/types';
import type { JiraAdapterConfig, JiraWebhookEventType, JiraEventConfig, JiraTaskInfo } from '../types.js';
import { getDefaultAcknowledgmentMessage } from '../types.js';
import { handleAcknowledge, AcknowledgeHandlerDeps } from './acknowledge-handler.js';
import { handleIgnore, IgnoreHandlerDeps } from './ignore-handler.js';
import { handleMissingLabels } from './missing-labels-handler.js';
import { extractAddedLabelsFromChangelog, extractLabelsBeforeUpdate } from '../changelog.js';

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
 * Core of the label-only flow:
 *
 *   - `jira:issue_created`: match labels → emit task, or post the
 *     "please add a matching tag" comment once.
 *   - `jira:issue_updated`: only react if the changelog added a label *and*
 *     that label now matches a configured repo; otherwise stay silent to
 *     avoid spamming the ticket on unrelated field edits.
 *   - Unknown / other events under the `analyze` action: fall back to
 *     "match or stay silent" with no comment, since we have no create/update
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

  const match = matcher.matchByLabels(taskInfo.labels);

  if (isUpdate) {
    const addedLabels = extractAddedLabelsFromChangelog(rawPayload);
    if (addedLabels.length === 0) {
      logger?.debug?.(
        `jira-adapter: ${taskInfo.key} update had no label additions — staying silent.`
      );
      return;
    }
    if (!match) {
      logger?.debug?.(
        `jira-adapter: ${taskInfo.key} update added labels [${addedLabels.join(', ')}] but none match a configured repo — staying silent.`
      );
      return;
    }
    // Stateless dedup: if the issue already had a matching label *before*
    // this update, the adapter (now or in a past run) already had a chance to
    // analyze it on create or on the first matching label-add. Re-running
    // analysis every time somebody tweaks labels would spam the ticket with
    // near-identical comments, so stay silent here.
    const previousLabels = extractLabelsBeforeUpdate(rawPayload);
    const previousMatch = matcher.matchByLabels(previousLabels);
    if (previousMatch) {
      logger?.info(
        `jira-adapter: ${taskInfo.key} already had matching label "${previousMatch.name}" before this update — skipping re-analysis.`
      );
      return;
    }
    logger?.info(
      `jira-adapter: ${taskInfo.key} update added label "${match.name}" → retrying analysis.`
    );
  } else if (!match) {
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

  if (!match) {
    // Defensive guard: the branches above should have returned when there is
    // no match, but this keeps TS happy and makes the invariant explicit.
    return;
  }

  const readOnly = config.analysisReadOnly !== false;

  events.emit(StandardEvents.TASK_CREATED, {
    id: taskInfo.key,
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
