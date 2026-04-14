import { execLocal } from '@agent-detective/process-utils';
import type { Commit } from '@agent-detective/types';

export async function gitLog(repoPath: string, options: { maxCommits?: number; filePattern?: string } = {}): Promise<Commit[]> {
  const { maxCommits = 50, filePattern } = options;

  const fileFilter = filePattern ? `--follow -- ${filePattern}` : '';

  const cmd = `git log --oneline -n ${maxCommits} ${fileFilter}`;

  try {
    const output = await execLocal('bash', ['-lc', cmd], {
      cwd: repoPath,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });

    const lines = output.split('\n').filter(Boolean);

    return lines.map((line) => {
      const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
      if (match) {
        return { hash: match[1], message: match[2] };
      }
      return { hash: line.slice(0, 7), message: line };
    });
  } catch (err) {
    console.warn(`git log failed for ${repoPath}: ${(err as Error).message}`);
    return [];
  }
}

export async function gitShow(repoPath: string, commitHash: string): Promise<Commit | null> {
  const cmd = `git show --stat --format="%H%n%an%n%ae%n%ad%n%s%n%b" ${commitHash}`;

  try {
    const output = await execLocal('bash', ['-lc', cmd], {
      cwd: repoPath,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });

    const lines = output.split('\n');
    const [hash, author, email, date, subject] = lines;

    return {
      hash,
      author,
      email,
      date,
      message: subject,
    };
  } catch (err) {
    console.warn(`git show failed for ${repoPath}@${commitHash}: ${(err as Error).message}`);
    return null;
  }
}

export async function gitDiff(repoPath: string, { from = 'HEAD~5', to = 'HEAD' }: { from?: string; to?: string } = {}): Promise<string> {
  const cmd = `git diff ${from}..${to} --stat`;

  try {
    const output = await execLocal('bash', ['-lc', cmd], {
      cwd: repoPath,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return output.trim();
  } catch (err) {
    console.warn(`git diff failed for ${repoPath}: ${(err as Error).message}`);
    return '';
  }
}
