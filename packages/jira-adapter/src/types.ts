export interface RepoInfo {
  name: string;
  path: string;
  techStack: string[];
  summary: string;
}

export interface DiscoveryConfig {
  enabled?: boolean;
  useAgentForDiscovery?: boolean;
  discoveryAgentId?: string;
  directMatchOnly?: boolean;
  fallbackOnNoMatch?: 'ask-agent' | 'use-first' | 'skip-analysis';
  discoveryPrompt?: string;
}

export interface DiscoveryContext {
  includeTechStack?: boolean;
  includeSummary?: boolean;
  maxReposShown?: number;
}

export interface AnalysisConfig {
  maxCommits?: number;
}

export interface JiraAdapterConfig {
  enabled?: boolean;
  webhookPath?: string;
  mockMode?: boolean;
  baseUrl?: string;
  email?: string;
  apiToken?: string;

  discovery?: DiscoveryConfig;
  discoveryContext?: DiscoveryContext;
  analysis?: AnalysisConfig;

  analysisPrompt?: string;
  discoveryPrompt?: string;
}

export interface JiraTaskInfo {
  id: string;
  key: string;
  summary: string;
  description: string;
  labels: string[];
  projectKey: string;
}

export interface JiraPayload {
  webhookEvent?: string;
  issue?: {
    key?: string;
    fields?: {
      summary?: string;
      description?: string;
      labels?: string[];
      project?: {
        key?: string;
      };
    };
  };
}

const DEFAULT_ANALYSIS_PROMPT = `You are a senior code analyst. A development team needs your help resolving an issue.

## Issue Information
Task Key: {task_key}
Summary: {task_summary}
Description: {task_description}
Labels: {task_labels}

## Related Repository
Name: {repo_name}
Path: {repo_path}
Tech Stack: {repo_tech_stack}
Summary: {repo_summary}
Recent Commits: {repo_commits}

## Your Task
Analyze the repository for the issue described. Identify:
1. Most likely root causes
2. Files or areas that need investigation
3. Suggested fixes or next steps

Provide a detailed and actionable analysis.`;

const DEFAULT_DISCOVERY_PROMPT = `Given this Jira task:
- Task Key: {task_key}
- Summary: {task_summary}
- Description: {task_description}
- Labels: {task_labels}

Which of these repositories is most likely the source of this issue?

Available Repositories:
{repos_list}

Respond with ONLY the repository name that best matches. If no repository seems related, respond with "none".`;

export function getDefaultAnalysisPrompt(): string {
  return DEFAULT_ANALYSIS_PROMPT;
}

export function getDefaultDiscoveryPrompt(): string {
  return DEFAULT_DISCOVERY_PROMPT;
}

export function formatTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '(not available)');
  }
  return result;
}
