import type { RepoInfo, JiraTaskInfo, DiscoveryConfig } from './types.js';
import { formatTemplate, getDefaultDiscoveryPrompt } from './types.js';

export function findDirectMatch(labels: string[], repos: RepoInfo[]): RepoInfo | null {
  for (const label of labels) {
    const normalizedLabel = label.toLowerCase();
    const match = repos.find(
      (repo) => repo.name.toLowerCase() === normalizedLabel
    );
    if (match) {
      return match;
    }
  }
  return null;
}

export function buildReposListForDiscovery(
  repos: RepoInfo[],
  context: { includeTechStack?: boolean; includeSummary?: boolean; maxReposShown?: number }
): string {
  const maxRepos = context.maxReposShown || repos.length;
  const reposToShow = repos.slice(0, maxRepos);

  return reposToShow.map((repo) => {
    let line = `- ${repo.name}`;
    if (context.includeTechStack && repo.techStack.length > 0) {
      line += ` (${repo.techStack.join(', ')})`;
    }
    if (context.includeSummary && repo.summary) {
      line += `: ${repo.summary}`;
    }
    return line;
  }).join('\n');
}

export function buildDiscoveryPrompt(
  taskInfo: JiraTaskInfo,
  repos: RepoInfo[],
  config: DiscoveryConfig,
  context: { includeTechStack?: boolean; includeSummary?: boolean }
): string {
  const template = config.discoveryPrompt || getDefaultDiscoveryPrompt();

  const reposList = buildReposListForDiscovery(repos, context);

  return formatTemplate(template, {
    task_key: taskInfo.key,
    task_summary: taskInfo.summary,
    task_description: taskInfo.description,
    task_labels: taskInfo.labels.join(', ') || '(no labels)',
    repos_list: reposList,
  });
}

export function parseAgentDiscoveryResponse(response: string): string | null {
  const trimmed = response.trim();

  if (trimmed.toLowerCase() === 'none') {
    return null;
  }

  const lines = trimmed.split('\n');
  const firstLine = lines[0].trim();

  if (firstLine.startsWith('-') || firstLine.startsWith('*')) {
    const match = firstLine.match(/^[-*]\s*(.+)/);
    if (match) {
      return match[1].trim();
    }
  }

  return firstLine;
}
