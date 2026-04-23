import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execLocal } from '@agent-detective/process-utils';
import type { AgentRunner, AgentOutput, AgentUsage, Logger, PrWorkflowInput } from '@agent-detective/types';
import type { LocalReposService } from '@agent-detective/local-repos-plugin';
import { createBitbucketPullRequest } from './bitbucket-pr.js';
import { createGithubPullRequest } from './github-pr.js';
import { resolveBitbucketAuth, resolveGithubToken } from './resolve-tokens.js';
import { stampJiraPr } from './stamp-jira.js';
import type { PrPipelineOptions } from './options-schema.js';

const GIT = { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 } as const;

function fmtDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function fmtTokens(n: number | undefined): string {
  if (n === undefined) return '—';
  return n.toLocaleString('en-US');
}

function sumUsage(a: AgentUsage | undefined, b: AgentUsage | undefined): AgentUsage {
  const add = (x?: number, y?: number) =>
    x !== undefined || y !== undefined ? (x ?? 0) + (y ?? 0) : undefined;
  return {
    wallTimeMs: add(a?.wallTimeMs, b?.wallTimeMs),
    durationMs: add(a?.durationMs, b?.durationMs),
    durationApiMs: add(a?.durationApiMs, b?.durationApiMs),
    numTurns: add(a?.numTurns, b?.numTurns),
    inputTokens: add(a?.inputTokens, b?.inputTokens),
    outputTokens: add(a?.outputTokens, b?.outputTokens),
    totalCostUsd: add(a?.totalCostUsd, b?.totalCostUsd),
  };
}

function buildAnalyticsBlock(writeOut: AgentOutput, summaryOut: AgentOutput | null): string {
  const w = writeOut.usage;
  const s = summaryOut?.usage;
  const hasSummary = s !== undefined;
  const total = hasSummary ? sumUsage(w, s) : w;
  const hasDetailedMetrics = w?.durationMs !== undefined || w?.numTurns !== undefined || w?.inputTokens !== undefined;

  if (!hasDetailedMetrics) {
    return `**Analytics:** Wall time: ${fmtDuration(w?.wallTimeMs)}`;
  }

  const cols = hasSummary
    ? ['Metric', 'Write', 'Summary', 'Total']
    : ['Metric', 'Value'];

  const row = (label: string, wVal: string, sVal: string, tVal: string) =>
    hasSummary ? `| ${label} | ${wVal} | ${sVal} | ${tVal} |` : `| ${label} | ${wVal} |`;

  const rows = [
    row('Wall time', fmtDuration(w?.wallTimeMs), fmtDuration(s?.wallTimeMs), fmtDuration(total?.wallTimeMs)),
    row('API time', fmtDuration(w?.durationApiMs), fmtDuration(s?.durationApiMs), fmtDuration(total?.durationApiMs)),
    row('Turns', String(w?.numTurns ?? '—'), String(s?.numTurns ?? '—'), String(total?.numTurns ?? '—')),
    row('Input tokens', fmtTokens(w?.inputTokens), fmtTokens(s?.inputTokens), fmtTokens(total?.inputTokens)),
    row('Output tokens', fmtTokens(w?.outputTokens), fmtTokens(s?.outputTokens), fmtTokens(total?.outputTokens)),
  ];

  const sep = hasSummary ? '|--------|-------|---------|-------|' : '|--------|-------|';
  const header = `| ${cols.join(' | ')} |`;

  return ['**Analytics**', '', header, sep, ...rows].join('\n');
}

interface ActiveWorktree {
  mainPath: string;
  workPath: string;
  branchName: string;
}

const activeWorktrees = new Set<ActiveWorktree>();

export async function cleanupWorktrees(logger: Pick<Logger, 'info'>): Promise<void> {
  if (activeWorktrees.size === 0) return;
  logger.info(`pr-pipeline: cleaning up ${activeWorktrees.size} active worktree(s)...`);
  for (const wt of activeWorktrees) {
    logger.info(`pr-pipeline: removing worktree ${wt.workPath} (branch: ${wt.branchName})`);
    try {
      await execLocal('git', ['-C', wt.mainPath, 'worktree', 'remove', '--force', wt.workPath], GIT);
    } catch { /* best effort */ }
    try {
      await rm(wt.workPath, { recursive: true, force: true });
    } catch { /* best effort */ }
    try {
      await execLocal('git', ['-C', wt.mainPath, 'branch', '-D', wt.branchName], GIT);
    } catch { /* best effort */ }
  }
  activeWorktrees.clear();
  logger.info('pr-pipeline: worktree cleanup complete');
}

function sanitizeBranchKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._/-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function buildBranchName(prefix: string, issueKey: string): string {
  const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return `${p}${sanitizeBranchKey(issueKey)}`;
}

function buildPrTitle(tpl: string, key: string, summary: string): string {
  return tpl.replaceAll('{{key}}', key).replaceAll('{{summary}}', summary.slice(0, 200) || 'Update');
}

export interface RunPrWorkflowDeps {
  localRepos: LocalReposService;
  agentRunner: AgentRunner;
  options: PrPipelineOptions;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
}

/**
 * Isolated worktree, write-mode agent, commit + push, GitHub or Bitbucket PR, Jira comment; cleanup on error.
 */
export async function runPrWorkflow(input: PrWorkflowInput, deps: RunPrWorkflowDeps): Promise<void> {
  const { localRepos, agentRunner, options, logger } = deps;
  const { issueKey, issueSummary, taskDescription, match, jira, analysisPrompt, prCommentContext } = input;
  const commentCtx = (prCommentContext || '').trim().slice(0, 12_000);
  const cfg = localRepos.getSourceRepoConfig(match.name);
  if (!cfg) {
    await jira.addComment(issueKey, stampJiraPr(`**pr-pipeline:** no source config for repo \`${match.name}\`.`));
    return;
  }
  const prBase = cfg.prBaseBranch || 'main';
  const globalPrefix = options.prBranchPrefix;
  const branchName = buildBranchName(cfg.prBranchPrefix ?? globalPrefix, issueKey);
  const mainPath = match.path;
  const vcs = cfg.vcs;
  const needsHost = !options.prDryRun;

  if (needsHost) {
    if (!vcs) {
      await jira.addComment(
        issueKey,
        stampJiraPr(
          '**pr-pipeline:** for a real push and PR, set `vcs` (GitHub or Bitbucket) on this repository entry in `local-repos` `repos[]`, or use `prDryRun: true` to test without a host.'
        )
      );
      return;
    }
    if (vcs.provider === 'github') {
      if (!resolveGithubToken(options)) {
        await jira.addComment(
          issueKey,
          stampJiraPr(
            '**pr-pipeline:** set a GitHub token: environment `GITHUB_TOKEN` or `GH_TOKEN` (preferred), or `githubToken` under `@agent-detective/pr-pipeline` in config. Env overrides file.'
          )
        );
        return;
      }
    } else if (vcs.provider === 'bitbucket') {
      if (!resolveBitbucketAuth(options)) {
        await jira.addComment(
          issueKey,
          stampJiraPr(
            '**pr-pipeline:** for Bitbucket, set an **access token** (`BITBUCKET_TOKEN` or `bitbucketToken` in config) *or* **app password** pair (`BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD`, or the matching plugin options). Token mode is used when a token is set. Env overrides file.'
          )
        );
        return;
      }
    } else {
      await jira.addComment(
        issueKey,
        stampJiraPr(
          `**pr-pipeline:** unsupported vcs provider \`${vcs.provider}\`. Use \`github\` or \`bitbucket\`, or \`prDryRun: true\`.`
        )
      );
      return;
    }
  }

  const workPath = await mkdtemp(join(tmpdir(), `ad-pr-${issueKey.replace(/[^a-z0-9]+/gi, '-')}-`));
  const title = buildPrTitle(options.prTitleTemplate, issueKey, issueSummary);
  const idSuffix = randomBytes(4).toString('hex');
  const wt: ActiveWorktree = { mainPath, workPath, branchName };

  try {
    await execLocal('git', ['-C', mainPath, 'fetch', 'origin'], GIT).catch((e) => {
      logger.warn(`pr-pipeline: git fetch in ${mainPath}: ${(e as Error).message}`);
    });
    const baseRef = `origin/${prBase}`;
    await execLocal('git', ['-C', mainPath, 'rev-parse', baseRef], GIT).catch(async () => {
      throw new Error(
        `Base ref ${baseRef} not found. Set prBaseBranch on the repo (current: ${prBase}) and ensure origin has that branch.`
      );
    });

    await execLocal('git', ['-C', mainPath, 'worktree', 'add', '-B', branchName, workPath, baseRef], GIT);
    activeWorktrees.add(wt);

    for (const raw of options.worktreeSetupCommands) {
      const cmd = raw.replaceAll('{{mainPath}}', mainPath);
      logger.info(`pr-pipeline: worktree setup: ${cmd}`);
      await execLocal('sh', ['-c', cmd], { timeout: 300_000, maxBuffer: 20 * 1024 * 1024, cwd: workPath }).catch((e) => {
        logger.warn(`pr-pipeline: worktree setup command failed (non-fatal): ${(e as Error).message}`);
      });
    }

    const userPrompt = [
      `Jira: ${issueKey} — ${issueSummary}`,
      ``,
      `Issue description (may contain markup):`,
      String(taskDescription || '').slice(0, 20_000),
      ``,
      ...(commentCtx
        ? [
            `## Additional context from the Jira comment (operator, after the PR trigger phrase):`,
            commentCtx,
            ``,
          ]
        : []),
      `You are on branch ${branchName} (from base ${prBase}) in a temporary worktree. Make minimal, reviewable code changes. Leave the working tree with changes ready to commit; the pipeline will commit and open a PR.`,
      analysisPrompt ? `## Extra instructions from operator:\n${analysisPrompt}` : '',
    ]
      .join('\n');

    const dryRunNote = options.prDryRun ? ' **Dry run** — no push or host PR will be created.' : '';
    await jira
      .addComment(
        issueKey,
        stampJiraPr(
          `**pr-pipeline** (${match.name}): running the coding agent in a worktree on \`${branchName}\` (base: \`${prBase}\`).${dryRunNote} ` +
            `This often takes several minutes; a follow-up comment will be posted when it finishes.`
        )
      )
      .catch((e) => logger.warn(`pr-pipeline: could not post 'started' Jira comment: ${(e as Error).message}`));

    const taskId = `pr-${issueKey}-${idSuffix}`;
    const out = await agentRunner.runAgentForChat(taskId, userPrompt, {
      ...(options.prAgent !== undefined ? { agentId: options.prAgent } : {}),
      cwd: workPath,
      repoPath: workPath,
      readOnly: false,
      ...(options.prAgentTimeoutMs !== undefined ? { timeoutMs: options.prAgentTimeoutMs } : {}),
      ...(options.prDebug
        ? {
            onProgress: (messages: string[]) => {
              for (const msg of messages) {
                logger.info(`pr-pipeline [${taskId}] agent: ${msg.slice(0, 500)}`);
              }
            },
            onStdout: (chunk: string) => {
              for (const line of chunk.split('\n')) {
                const trimmed = line.trim();
                if (trimmed) logger.info(`pr-pipeline [${taskId}] stdout: ${trimmed.slice(0, 500)}`);
              }
            },
          }
        : {}),
    });

    const status = await execLocal('git', ['-C', workPath, 'status', '--porcelain'], GIT);
    if (!status.trim()) {
      await jira.addComment(issueKey, stampJiraPr(`**pr-pipeline** (${match.name}): no file changes; agent output:\n\n${out.text.slice(0, 4_000)}`));
      return;
    }

    await execLocal('git', ['-C', workPath, 'config', 'user.name', 'agent-detective'], GIT);
    await execLocal('git', ['-C', workPath, 'config', 'user.email', 'agent-detective@local'], GIT);
    await execLocal('git', ['-C', workPath, 'add', '-A'], GIT);
    await execLocal('git', ['-C', workPath, 'commit', '--no-verify', '-m', `fix(${issueKey}): ${issueSummary.slice(0, 80) || 'agent-detective'}`], GIT);

    if (options.prDryRun) {
      let where: string;
      if (!vcs) {
        where = `\`${cfg.vcs?.owner ?? 'unknown'}/${cfg.vcs?.name ?? 'unknown'}\` (set \`vcs\` on this repo in local-repos for GitHub or Bitbucket)`;
      } else if (vcs.provider === 'github') {
        where = `GitHub \`${vcs.owner}/${vcs.name}\``;
      } else if (vcs.provider === 'bitbucket') {
        where = `Bitbucket \`${vcs.owner}/${vcs.name}\``;
      } else {
        where = `host provider \`${vcs.provider}\``;
      }
      await jira.addComment(
        issueKey,
        stampJiraPr(
          `**pr-pipeline** (${match.name}, **dry run**): would create branch \`${branchName}\` and open a PR ` +
            `on ${where} (base: \`${prBase}\`).\n\n---\n\nAgent report (truncated):\n\n${out.text.slice(0, 3_000)}`
        )
      );
      return;
    }

    const diffStat = await execLocal('git', ['-C', workPath, 'diff', '--stat', 'HEAD~1'], GIT).catch(() => '');

    let prSummary = '';
    let summaryOut: AgentOutput | null = null;
    if (out.threadId) {
      logger.info(`pr-pipeline: requesting PR summary from agent (threadId=${out.threadId})`);
      const summaryTaskId = `pr-summary-${issueKey}-${idSuffix}`;
      const summaryPrompt = [
        `You just made code changes for Jira issue ${issueKey}: ${issueSummary}.`,
        ``,
        `Write a concise pull request description (2-5 bullet points) summarising:`,
        `- What you changed and why`,
        `- Any important design decisions or trade-offs`,
        `- Anything a reviewer should pay attention to`,
        ``,
        `Do not include the branch name, issue key, or generic boilerplate. Plain markdown only.`,
      ].join('\n');
      summaryOut = await agentRunner.runAgentForChat(summaryTaskId, summaryPrompt, {
        ...(options.prAgent !== undefined ? { agentId: options.prAgent } : {}),
        cwd: workPath,
        repoPath: workPath,
        readOnly: true,
        threadId: out.threadId,
      }).catch((e) => {
        logger.warn(`pr-pipeline: summary agent call failed (non-fatal): ${(e as Error).message}`);
        return null;
      });
      if (summaryOut?.text?.trim()) {
        prSummary = summaryOut.text.trim();
      }
    }

    const analyticsBlock = options.prAnalytics ? buildAnalyticsBlock(out, summaryOut) : null;

    const prBody = [
      `## ${issueKey}: ${issueSummary}`,
      ``,
      `Automated PR generated by **agent-detective pr-pipeline**.`,
      ``,
      `### Changes`,
      '```',
      diffStat.trim() || '(no diff stat available)',
      '```',
      ``,
      ...(prSummary
        ? [`### Summary`, ``, prSummary.slice(0, 6_000)]
        : out.text.trim()
        ? [`### Agent output`, ``, out.text.trim().slice(0, 6_000)]
        : []),
      ...(analyticsBlock ? [``, `---`, ``, analyticsBlock] : []),
      ``,
      `---`,
      `*🤖 Generated with [agent-detective](https://github.com/toniop99/agent-detective)*`,
    ].join('\n');
    if (!vcs) {
      throw new Error('pr-pipeline: internal: vcs missing after validation');
    }
    if (vcs.provider === 'bitbucket') {
      const bb = resolveBitbucketAuth(options);
      if (!bb) {
        throw new Error('pr-pipeline: internal: Bitbucket credentials missing after validation');
      }
      const path = `${encodeURIComponent(vcs.owner)}/${encodeURIComponent(vcs.name)}.git`;
      const pushUrl =
        bb.mode === 'token'
          ? `https://x-token-auth:${encodeURIComponent(bb.token)}@bitbucket.org/${path}`
          : `https://${encodeURIComponent(bb.username)}:${encodeURIComponent(bb.appPassword)}@bitbucket.org/${path}`;
      await execLocal('git', ['-C', workPath, 'push', '--no-verify', '-u', pushUrl, `HEAD:refs/heads/${branchName}`], GIT);
      const pr = await createBitbucketPullRequest({
        auth:
          bb.mode === 'token'
            ? { type: 'bearer', token: bb.token }
            : { type: 'basic', email: bb.email, appPassword: bb.appPassword },
        workspace: vcs.owner,
        repoSlug: vcs.name,
        title,
        description: prBody,
        sourceBranch: branchName,
        destinationBranch: prBase,
      });
      await jira.addComment(
        issueKey,
        stampJiraPr(
          [
            `**Pull request opened** (Bitbucket, ${match.name}): ${pr.htmlUrl}`,
            ``,
            `**Summary:** ${issueSummary}`
          ].join('\n')
        )
      );
    } else if (vcs.provider === 'github') {
      const tokenGh = resolveGithubToken(options);
      if (!tokenGh) {
        throw new Error('pr-pipeline: internal: GitHub token missing after validation');
      }
      const pushUrl = `https://x-access-token:${encodeURIComponent(tokenGh)}@github.com/${encodeURIComponent(vcs.owner)}/${encodeURIComponent(vcs.name)}.git`;
      await execLocal('git', ['-C', workPath, 'push', '--no-verify', '-u', pushUrl, `HEAD:refs/heads/${branchName}`], GIT);
      const pr = await createGithubPullRequest({
        token: tokenGh,
        owner: vcs.owner,
        repo: vcs.name,
        title,
        head: branchName,
        base: prBase,
        body: prBody,
      });
      await jira.addComment(
        issueKey,
        stampJiraPr(
          [
            `**Pull request opened** (${match.name}): ${pr.htmlUrl}`,
            ``,
            `**Summary:** ${issueSummary}`,
            ...(analyticsBlock ? [``, analyticsBlock] : []),
          ].join('\n')
        )
      );
    } else {
      throw new Error(`pr-pipeline: internal: unsupported vcs ${vcs.provider}`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`pr-pipeline: failed for ${issueKey} / ${match.name}: ${msg}`);
    await jira
      .addComment(issueKey, stampJiraPr(`**pr-pipeline** (${match.name}): failed — \`${msg.slice(0, 3_000)}\``))
      .catch((e) => logger.error(String(e)));
  } finally {
    try {
      await execLocal('git', ['-C', mainPath, 'worktree', 'remove', '--force', workPath], GIT);
    } catch {
      /* best effort */
    }
    try {
      await rm(workPath, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    try {
      await execLocal('git', ['-C', mainPath, 'branch', '-D', branchName], GIT);
    } catch {
      /* branch may not exist or still used */
    }
    activeWorktrees.delete(wt);
  }
}

/** Thin adapter: real Jira client or mock. */
