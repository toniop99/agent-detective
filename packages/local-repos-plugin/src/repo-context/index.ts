import { gitLog, gitShow, gitDiff } from './git-log.js';
import type { RepoContext, BuildRepoContextOptions } from '@agent-detective/types';

export async function buildRepoContext(repoPath: string, options: BuildRepoContextOptions = {}): Promise<RepoContext> {
  const { maxCommits = 50, logger, gitCommandTimeoutMs, gitMaxBufferBytes } = options;

  const commits = await gitLog(repoPath, {
    maxCommits,
    logger,
    commandTimeoutMs: gitCommandTimeoutMs,
    maxBufferBytes: gitMaxBufferBytes,
  });
  const repoName = repoPath.split('/').pop() ?? repoPath;

  return {
    repoName,
    repoPath,
    recentCommits: commits,
    stats: {
      commitCount: commits.length,
    },
  };
}

export function formatRepoContextForPrompt(context: RepoContext): string {
  const lines: string[] = [];

  lines.push(`## Repository: ${context.repoName}`);
  lines.push(`Path: ${context.repoPath}\n`);

  lines.push(`### Recent Commits (${context.recentCommits.length}):`);
  if (context.recentCommits.length > 0) {
    for (const commit of context.recentCommits.slice(0, 20)) {
      lines.push(`- ${commit.hash.slice(0, 7)} ${commit.message}`);
    }
    if (context.recentCommits.length > 20) {
      lines.push(`  ... and ${context.recentCommits.length - 20} more`);
    }
  } else {
    lines.push('(No recent commits found)');
  }

  return lines.join('\n');
}

export { gitLog, gitShow, gitDiff };