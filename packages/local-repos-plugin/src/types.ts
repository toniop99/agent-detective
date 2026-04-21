import type { Commit, BuildRepoContextOptions } from '@agent-detective/types';

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
  /** Truncate agent- and heuristics-generated summaries; default 500. */
  maxOutputChars?: number;
}

export interface ValidationConfig {
  failOnMissing?: boolean;
}

export interface RepoContextConfig {
  gitLogMaxCommits?: number;
  gitCommandTimeoutMs?: number;
  gitMaxBufferBytes?: number;
  /**
   * Passed to `git diff` as the `from` ref (default in code: `HEAD~5`).
   * Configured in options / env `REPO_CONTEXT_DIFF_FROM_REF`.
   */
  diffFromRef?: string;
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

export interface LocalReposService {
  localRepos: LocalReposContext;
  buildRepoContext: (repoPath: string, options?: BuildRepoContextOptions) => Promise<unknown>;
  formatRepoContextForPrompt: (context: unknown) => string;
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

const DEFAULT_ANALYSIS_PROMPT = `You are a senior code analyst performing a READ-ONLY investigation. A development team needs your help understanding an issue — you are NOT being asked to fix it. Your analysis will be posted back as a Jira comment.

## Strict Rules (must follow)
- DO NOT modify, create, rename, or delete any file in the repository.
- DO NOT run shell commands that have side effects (no installs, no builds, no migrations, no git writes).
- You MAY read files, search the code, and inspect git history.
- Your only deliverable is a written analysis. Any code changes must be proposed as text, never applied.

## Output format (IMPORTANT — we render this as a Jira comment)
Return **GitHub-Flavored Markdown**. Keep it concise and scannable:

- Use \`##\` / \`###\` headings for the sections below. Do not use \`#\` (Jira renders H1 very large).
- Use **bold** for the final verdict and key terms.
- Use \`inline code\` for file names, symbols, env vars, config keys, and short literals.
- Use fenced code blocks with a language tag for snippets and stack traces — e.g. \`\`\`ts, \`\`\`bash, \`\`\`json, \`\`\`text.
- Use bullet lists for findings; numbered lists for ordered steps.
- Reference code with \`path/to/file.ts:LINE\` inline — do not paste whole files.
- No HTML, no emojis, no tables.

### Required sections (use these exact headings)

## Summary
One or two sentences: what is happening and the most likely cause. End with a **bolded** verdict such as **Likely root cause: …** or **Needs more data**.

## Root Cause Analysis
Bullet points listing the most likely root causes, each anchored to evidence in the code (with \`path/to/file.ts:LINE\` references). If multiple hypotheses exist, rank them.

## Files / Areas to Investigate
Bullet list of the specific files, modules, or subsystems to inspect. Add a one-line reason per entry.

## Suggested Next Steps
A short numbered list of concrete next actions (reproduce step, targeted fix, test to add, data to collect). Describe code changes with fenced code snippets — never apply them.

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

Return ONLY the Markdown report as your final message — no preamble, no meta commentary, no "I will now…" narration. Do not attempt to implement the fix.`;

export function getDefaultAnalysisPrompt(): string {
  return DEFAULT_ANALYSIS_PROMPT;
}

export function formatTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '(not available)');
  }
  return result;
}
