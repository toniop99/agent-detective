import type { Commit } from '@agent-detective/types';

export interface RepoConfig {
  name: string;
  path: string;
  description?: string;
  techStack?: string[];
}

export interface TechStackDetectionConfig {
  enabled?: boolean;
  patterns?: Record<string, string[]>;
}

export interface SummaryGenerationConfig {
  enabled?: boolean;
  source?: 'readme' | 'commits' | 'both';
  maxReadmeLines?: number;
  commitCount?: number;
  useAgent?: boolean;
  agentId?: string;
  model?: string;
  summaryPrompt?: string;
}

export interface ValidationConfig {
  validateOnStartup?: boolean;
  failOnMissing?: boolean;
}

export interface RepoContextConfig {
  gitLogMaxCommits?: number;
}

export interface DiscoveryConfig {
  enabled?: boolean;
  useAgentForDiscovery?: boolean;
  discoveryAgentId?: string;
  discoveryModel?: string;
  discoveryPrompt?: string;
  directMatchOnly?: boolean;
  fallbackOnNoMatch?: 'none' | 'ask-agent';
}

export interface DiscoveryContextConfig {
  includeTechStack?: boolean;
  includeSummary?: boolean;
  maxReposShown?: number;
}

export interface LocalReposPluginOptions {
  repos: RepoConfig[];
  techStackDetection?: TechStackDetectionConfig;
  summaryGeneration?: SummaryGenerationConfig;
  validation?: ValidationConfig;
  repoContext?: RepoContextConfig;
  discovery?: DiscoveryConfig;
  discoveryContext?: DiscoveryContextConfig;
}

export interface TaskInfoForDiscovery {
  id: string;
  summary: string;
  description: string;
  labels: string[];
  metadata?: Record<string, unknown>;
}

export interface ValidatedRepo {
  name: string;
  path: string;
  exists: boolean;
  description?: string;
  techStack: string[];
  summary: string;
  commits: Commit[];
  lastChecked: Date;
}

export interface LocalReposContext {
  repos: ValidatedRepo[];
  getRepo(name: string): ValidatedRepo | null;
  getAllRepos(): ValidatedRepo[];
}

const DEFAULT_TECH_STACK_PATTERNS: Record<string, string[]> = {
  node: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'],
  python: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
  java: ['pom.xml', 'build.gradle', 'gradle.lockfile'],
  go: ['go.mod', 'go.sum'],
  ruby: ['Gemfile', 'Gemfile.lock'],
  rust: ['Cargo.toml', 'Cargo.lock'],
  dotnet: ['*.csproj', '*.sln'],
  php: ['composer.json', 'composer.lock'],
  typescript: ['tsconfig.json', 'package.json'],
};

const DEFAULT_SUMMARY_CONFIG: SummaryGenerationConfig = {
  enabled: true,
  source: 'both',
  maxReadmeLines: 3,
  commitCount: 10,
  useAgent: false,
  agentId: 'opencode',
  model: undefined,
  summaryPrompt: 'Summarize this repository in 2-3 sentences based on the provided context.',
};

const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  validateOnStartup: true,
  failOnMissing: false,
};

export function getDefaultTechStackPatterns(): Record<string, string[]> {
  return { ...DEFAULT_TECH_STACK_PATTERNS };
}

export function getDefaultSummaryConfig(): SummaryGenerationConfig {
  return { ...DEFAULT_SUMMARY_CONFIG };
}

export function getDefaultValidationConfig(): ValidationConfig {
  return { ...DEFAULT_VALIDATION_CONFIG };
}

const DEFAULT_ANALYSIS_PROMPT = `You are a senior code analyst. A development team needs your help resolving an issue.

## Issue Information
Task ID: {task_id}
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

const DEFAULT_DISCOVERY_PROMPT = `Given this task:
- Task ID: {task_id}
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
