export type JiraWebhookEventType = 'jira:issue_created' | 'jira:issue_updated' | 'jira:issue_deleted';
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
  webhookPath?: string;
  mockMode?: boolean;
  baseUrl?: string;
  email?: string;
  apiToken?: string;

  webhookBehavior?: JiraWebhookBehavior;

  analysisPrompt?: string;
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

export interface JiraDescription {
  content?: Array<{
    content?: Array<{ text?: string }>;
    text?: string;
  }>;
}

export interface JiraUser {
  self?: string;
  name?: string | null;
  key?: string | null;
  accountId?: string;
  emailAddress?: string | null;
  avatarUrls?: Record<string, string>;
  displayName?: string;
  active?: boolean;
  timeZone?: string | null;
  groups?: unknown;
  locale?: string | null;
  accountType?: string;
}

export interface JiraProject {
  self?: string;
  id?: string;
  key?: string;
  name?: string;
  description?: string | null;
  avatarUrls?: Record<string, string>;
  issuetypes?: unknown;
  projectCategory?: unknown;
  email?: string | null;
  lead?: unknown;
  components?: unknown;
  versions?: unknown;
  projectTypeKey?: string;
  simplified?: boolean;
}

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
