export type JiraWebhookEventType =
  | 'jira:issue_created'
  | 'jira:issue_updated'
  | 'jira:issue_deleted'
  | 'jira:comment_created';
export type EventAction = 'analyze' | 'acknowledge' | 'ignore';

export interface JiraEventConfig {
  action: EventAction;
  analysisPrompt?: string;
  acknowledgmentMessage?: string;
}

export interface JiraWebhookBehavior {
  defaults: JiraEventConfig;
  events: Partial<Record<JiraWebhookEventType, JiraEventConfig>>;
}

export interface JiraAdapterConfig {
  enabled?: boolean;
  mockMode?: boolean;
  baseUrl?: string;
  email?: string;
  apiToken?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRefreshToken?: string;
  oauthRedirectBaseUrl?: string;
  cloudId?: string;

  webhookBehavior?: JiraWebhookBehavior;

  analysisPrompt?: string;

  /**
   * When true (default), the `analyze` action runs the agent with its
   * write/edit/shell tools DENIED, so the investigation can never modify
   * the target repository. Set to `false` only if you explicitly want the
   * agent to be able to apply fixes in response to Jira tickets.
   */
  analysisReadOnly?: boolean;

  /**
   * Markdown template posted to Jira on `issue_created` when no label matches
   * a configured repo. Supports `{available_labels}` and `{issue_key}`
   * placeholders. Leave unset to use the built-in default.
   */
  missingLabelsMessage?: string;

  /**
   * Safety cap on how many repos a single Jira issue may fan out to when
   * several of its labels match configured repos. Matches beyond this cap
   * are logged and noted in the acknowledgment comment, but not analyzed.
   * Set to `0` to disable the cap (not recommended).
   *
   * Default: 5.
   */
  maxReposPerIssue?: number;

  /**
   * Phrase that, when found inside a Jira comment by a non-adapter user,
   * triggers (or re-triggers) label matching and analysis. The match is
   * case-insensitive and substring-based so operators can embed it in
   * longer sentences (e.g. "hey #agent-detective analyze please"). Every
   * comment we post gets tagged with a hidden marker so our own output —
   * including result comments that happen to quote the phrase — never
   * re-triggers the flow.
   *
   * Default: `#agent-detective analyze`.
   */
  retryTriggerPhrase?: string;

  /**
   * Comment-only trigger for the PR pipeline (`#agent-detective pr` by default).
   * See `options-schema.ts`.
   */
  prTriggerPhrase?: string;

  /** See `options-schema.ts` — default 10 minutes. */
  autoAnalysisCooldownMs?: number;

  /** See `options-schema.ts` — default 60 seconds. */
  missingLabelsReminderCooldownMs?: number;

  /**
   * Identity of the Jira account the adapter posts as. Used as a secondary
   * safeguard when filtering our own comments: any comment whose author
   * matches `accountId` or `email` is ignored regardless of whether it
   * carries the hidden marker. Optional — in `mockMode` and most
   * deployments the marker alone is sufficient, but setting this makes
   * loop protection robust against bot account impersonation or future
   * marker changes.
   */
  jiraUser?: {
    accountId?: string;
    email?: string;
  };

  /**
   * When true, the adapter fetches all comments on the Jira issue before
   * dispatching the PR workflow and passes human-authored ones (app comments
   * excluded) to pr-pipeline as additional agent context.
   *
   * Default: false.
   */
  fetchIssueComments?: boolean;

  /**
   * Append fenced JSON (`agent-detective/jira-comment-metadata/v1`) after
   * analysis Markdown for Jira Automation. Default false.
   */
  structuredCommentMetadata?: boolean;
}

export interface JiraTaskInfo {
  id: string;
  key: string;
  summary: string;
  description: string;
  labels: string[];
  projectKey: string;
  projectName?: string;
  issueType?: string;
  reporter?: string;
  assignee?: string;
  priority?: string;
  status?: string;
  created?: string;
}

import type { Version3Models } from 'jira.js';
type JiraSdkUser = Version3Models.User;
type JiraSdkProject = Version3Models.Project;

export interface JiraDescription {
  content?: Array<{
    content?: Array<{ text?: string }>;
    text?: string;
  }>;
}

/**
 * Webhook user shape — structurally aligned with `jira.js/version3/models/User`
 * but every field is optional because Jira webhooks omit fields depending on
 * account privacy settings and event type.
 */
export type JiraUser = Partial<JiraSdkUser>;

/**
 * Webhook project shape — structurally aligned with `jira.js/version3/models/Project`
 * with all fields optional. Webhooks send a minimal subset compared to the full
 * REST project resource.
 */
export type JiraProject = Partial<JiraSdkProject>;

export interface JiraIssue {
  self?: string;
  id?: string;
  key?: string;
  changelog?: {
    startAt?: number;
    maxResults?: number;
    total?: number;
    histories?: unknown[] | null;
  };
  fields?: {
    statuscategorychangedate?: string;
    issuetype?: {
      namedValue?: string;
      self?: string;
      id?: string;
      description?: string;
      iconUrl?: string;
      name?: string;
      untranslatedName?: string | null;
      subtask?: boolean;
      fields?: unknown;
      statuses?: unknown[];
      hierarchyLevel?: number;
    };
    components?: unknown[];
    timespent?: unknown;
    timeoriginalestimate?: unknown;
    project?: JiraProject;
    description?: string | JiraDescription;
    fixVersions?: unknown[];
    statusCategory?: {
      self?: string;
      id?: number;
      key?: string;
      colorName?: string;
      name?: string;
    };
    aggregatetimespent?: unknown;
    resolution?: unknown;
    customfield_10036?: unknown;
    timetracking?: {
      originalEstimate?: unknown;
      remainingEstimate?: unknown;
      timeSpent?: unknown;
      originalEstimateSeconds?: number;
      remainingEstimateSeconds?: number;
      timeSpentSeconds?: number;
    };
    customfield_10015?: unknown;
    security?: unknown;
    attachment?: unknown[];
    aggregatetimeestimate?: unknown;
    resolutiondate?: unknown;
    workratio?: number;
    summary?: string;
    watches?: {
      self?: string;
      watchCount?: number;
      isWatching?: boolean;
    };
    issuerestriction?: {
      issuerestrictions?: Record<string, unknown>;
      shouldDisplay?: boolean;
    };
    lastViewed?: unknown;
    creator?: JiraUser;
    subtasks?: unknown[];
    created?: number;
    customfield_10021?: unknown;
    reporter?: JiraUser;
    aggregateprogress?: { progress?: number; total?: number };
    priority?: {
      self?: string;
      id?: string;
      name?: string;
      iconUrl?: string;
      namedValue?: string;
    };
    customfield_10001?: unknown;
    labels?: string[];
    environment?: unknown;
    customfield_10019?: unknown;
    timeestimate?: unknown;
    aggregatetimeoriginalestimate?: unknown;
    versions?: unknown[];
    duedate?: unknown;
    progress?: { progress?: number; total?: number };
    issuelinks?: unknown[];
    votes?: {
      self?: string;
      votes?: number;
      hasVoted?: boolean;
    };
    comment?: {
      maxResults?: number;
      total?: number;
      startAt?: number;
      comments?: unknown[];
      last?: boolean;
    };
    assignee?: JiraUser | null;
    worklog?: {
      maxResults?: number;
      total?: number;
      startAt?: number;
      worklogs?: unknown[];
      last?: boolean;
    };
    updated?: number;
    status?: {
      untranslatedNameValue?: string | null;
      self?: string;
      description?: string;
      iconUrl?: string;
      name?: string;
      untranslatedName?: string | null;
      id?: string;
      statusCategory?: {
        self?: string;
        id?: number;
        key?: string;
        colorName?: string;
        name?: string;
      };
    };
  };
  renderedFields?: unknown;
}

export interface JiraPayload {
  webhookEvent?: string;
  timestamp?: number;
  issue?: JiraIssue;
  user?: JiraUser;
}

const DEFAULT_ACKNOWLEDGMENT_MESSAGE = 'Thanks for the update! I will review this issue and provide feedback shortly.';

export function getDefaultAcknowledgmentMessage(): string {
  return DEFAULT_ACKNOWLEDGMENT_MESSAGE;
}

export function formatTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '(not available)');
  }
  return result;
}
