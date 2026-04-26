import { execLocal } from '@agent-detective/process-utils';
import type { Commit, Logger } from '@agent-detective/sdk';

type WarnLog = Pick<Logger, 'warn'>;

function warn(log: WarnLog | undefined, message: string): void {
  if (log) {
    log.warn(message);
  }
}

export async function gitLog(
  repoPath: string,
  options: {
    maxCommits?: number;
    filePattern?: string;
    logger?: WarnLog;
    commandTimeoutMs?: number;
    maxBufferBytes?: number;
  } = {},
): Promise<Commit[]> {
  const { maxCommits = 50, filePattern, logger, commandTimeoutMs = 10_000, maxBufferBytes = 1024 * 1024 } =
    options;

  const fileFilter = filePattern ? `--follow -- ${filePattern}` : '';

  const cmd = `git log --oneline -n ${maxCommits} ${fileFilter}`;

  try {
    const output = await execLocal('bash', ['-lc', cmd], {
      cwd: repoPath,
      timeout: commandTimeoutMs,
      maxBuffer: maxBufferBytes,
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
    warn(logger, `git log failed for ${repoPath}: ${(err as Error).message}`);
    return [];
  }
}

export async function gitShow(
  repoPath: string,
  commitHash: string,
  options: { logger?: WarnLog; commandTimeoutMs?: number; maxBufferBytes?: number } = {},
): Promise<Commit | null> {
  const { logger, commandTimeoutMs = 10_000, maxBufferBytes = 1024 * 1024 } = options;
  const cmd = `git show --stat --format="%H%n%an%n%ae%n%ad%n%s%n%b" ${commitHash}`;

  try {
    const output = await execLocal('bash', ['-lc', cmd], {
      cwd: repoPath,
      timeout: commandTimeoutMs,
      maxBuffer: maxBufferBytes,
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
    warn(logger, `git show failed for ${repoPath}@${commitHash}: ${(err as Error).message}`);
    return null;
  }
}

export async function gitDiff(
  repoPath: string,
  {
    from = 'HEAD~5',
    to = 'HEAD',
    logger,
    commandTimeoutMs = 10_000,
    maxBufferBytes = 1024 * 1024,
  }: {
    from?: string;
    to?: string;
    logger?: WarnLog;
    commandTimeoutMs?: number;
    maxBufferBytes?: number;
  } = {},
): Promise<string> {
  const cmd = `git diff ${from}..${to} --stat`;

  try {
    const output = await execLocal('bash', ['-lc', cmd], {
      cwd: repoPath,
      timeout: commandTimeoutMs,
      maxBuffer: maxBufferBytes,
    });
    return output.trim();
  } catch (err) {
    warn(logger, `git diff failed for ${repoPath}: ${(err as Error).message}`);
    return '';
  }
}
