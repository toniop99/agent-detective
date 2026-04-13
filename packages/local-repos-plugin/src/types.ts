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

export interface LocalReposPluginOptions {
  repos: RepoConfig[];
  techStackDetection?: TechStackDetectionConfig;
  summaryGeneration?: SummaryGenerationConfig;
  validation?: ValidationConfig;
  repoContext?: RepoContextConfig;
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
