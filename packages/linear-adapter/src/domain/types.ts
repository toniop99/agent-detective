export type LinearEventAction = 'analyze' | 'acknowledge' | 'ignore';

export interface LinearEventConfig {
  action: LinearEventAction;
  analysisPrompt?: string;
  acknowledgmentMessage?: string;
}

export interface LinearWebhookBehavior {
  defaults: LinearEventConfig;
  /** Keys are canonical webhook names, e.g. `linear:Issue:create`. */
  events?: Record<string, LinearEventConfig>;
}

/** Issue identity and fields used for RepoMatcher + TASK_CREATED (mirrors JiraTaskInfo). */
export interface LinearTaskInfo {
  /** Linear Issue UUID (GraphQL id). */
  issueUuid: string;
  /** Human identifier e.g. ENG-123 (used in task ids / logs). */
  key: string;
  summary: string;
  description: string;
  /** Short team key parsed from identifier prefix when available. */
  projectKey: string;
  labels: string[];
}
