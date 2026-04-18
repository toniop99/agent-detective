import type { ValidatedRepo, TaskInfoForDiscovery, DiscoveryConfig } from './types.js';
import { formatTemplate, getDefaultDiscoveryPrompt } from './types.js';

export function findDirectMatch(labels: string[], repos: ValidatedRepo[]): ValidatedRepo | null {
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
  repos: ValidatedRepo[],
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
  taskInfo: TaskInfoForDiscovery,
  repos: ValidatedRepo[],
  config: DiscoveryConfig,
  context: { includeTechStack?: boolean; includeSummary?: boolean }
): string {
  const template = config.discoveryPrompt || getDefaultDiscoveryPrompt();

  const reposList = buildReposListForDiscovery(repos, context);

  return formatTemplate(template, {
    task_id: taskInfo.id,
    task_summary: taskInfo.summary,
    task_description: taskInfo.description,
    task_labels: taskInfo.labels.join(', ') || '(no labels)',
    repos_list: reposList,
  });
}

export function parseAgentDiscoveryResponse(response: string, availableRepos: ValidatedRepo[]): string | null {
  const trimmed = response.trim();
  const lowerResponse = trimmed.toLowerCase();

  if (lowerResponse === 'none' || lowerResponse.includes('no repository seems related')) {
    return null;
  }

  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const repoNames = availableRepos.map(r => r.name);
  const repoNamesLower = repoNames.map(n => n.toLowerCase());

  // 1. Look for a line that exactly matches a repo name (case-insensitive)
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    const index = repoNamesLower.indexOf(lowerLine);
    if (index !== -1) {
      return repoNames[index];
    }
  }

  // 2. Look for a line that starts with a bullet point and contains a repo name
  for (const line of lines) {
    if (line.startsWith('-') || line.startsWith('*')) {
      const content = line.replace(/^[-*]\s*/, '').trim();
      const contentLower = content.toLowerCase();
      
      // Exact match after bullet
      const index = repoNamesLower.indexOf(contentLower);
      if (index !== -1) {
        return repoNames[index];
      }

      // See if the content starts with a repo name
      for (let i = 0; i < repoNamesLower.length; i++) {
        if (contentLower.startsWith(repoNamesLower[i])) {
          return repoNames[i];
        }
      }
    }
  }

  // 3. Just take the first line and try to find a repo name in it
  if (lines.length > 0) {
    const firstLine = lines[0];
    const firstLineLower = firstLine.toLowerCase();
    for (let i = 0; i < repoNamesLower.length; i++) {
      if (firstLineLower.includes(repoNamesLower[i])) {
        return repoNames[i];
      }
    }
  }

  return null;
}
