import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execLocal } from '@agent-detective/process-utils';
import type { AgentRunner, Logger, PrWorkflowInput } from '@agent-detective/types';
import type { LocalReposService } from '@agent-detective/local-repos-plugin';
import { createBitbucketPullRequest } from './bitbucket-pr.js';
import { createGithubPullRequest } from './github-pr.js';
import { resolveBitbucketAuth, resolveGithubToken } from './resolve-tokens.js';
import { stampJiraPr } from './stamp-jira.js';
import type { PrPipelineOptions } from './options-schema.js';

const GIT = { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 } as const;

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

    const taskId = `pr-${issueKey}-${idSuffix}`;
    const out = await agentRunner.runAgentForChat(taskId, userPrompt, {
      agentId: 'opencode',
      cwd: workPath,
      repoPath: workPath,
      readOnly: false,
    });

    const status = await execLocal('git', ['-C', workPath, 'status', '--porcelain'], GIT);
    if (!status.trim()) {
      await jira.addComment(issueKey, stampJiraPr(`**pr-pipeline** (${match.name}): no file changes; agent output:\n\n${out.slice(0, 4_000)}`));
      return;
    }

    await execLocal('git', ['-C', workPath, 'config', 'user.name', 'agent-detective'], GIT);
    await execLocal('git', ['-C', workPath, 'config', 'user.email', 'agent-detective@local'], GIT);
    await execLocal('git', ['-C', workPath, 'add', '-A'], GIT);
    await execLocal('git', ['-C', workPath, 'commit', '-m', `fix(${issueKey}): ${issueSummary.slice(0, 80) || 'agent-detective'}`], GIT);

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
            `on ${where} (base: \`${prBase}\`).\n\n---\n\nAgent report (truncated):\n\n${out.slice(0, 3_000)}`
        )
      );
      return;
    }

    const prBody = `Automated for **${issueKey}** (agent-detective pr-pipeline).\n\n---\n\n${out.slice(0, 6_000)}`;
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
      await execLocal('git', ['-C', workPath, 'push', '-u', pushUrl, `HEAD:refs/heads/${branchName}`], GIT);
      const pr = await createBitbucketPullRequest({
        auth:
          bb.mode === 'token'
            ? { type: 'bearer', token: bb.token }
            : { type: 'basic', username: bb.username, appPassword: bb.appPassword },
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
          `**Pull request opened** (Bitbucket, ${match.name}): ${pr.htmlUrl}\n\n**Summary:** ${issueSummary}\n\n---\n\n_(Agent output length ${out.length} chars, truncated in PR body if needed.)_`
        )
      );
    } else if (vcs.provider === 'github') {
      const tokenGh = resolveGithubToken(options);
      if (!tokenGh) {
        throw new Error('pr-pipeline: internal: GitHub token missing after validation');
      }
      const pushUrl = `https://x-access-token:${encodeURIComponent(tokenGh)}@github.com/${encodeURIComponent(vcs.owner)}/${encodeURIComponent(vcs.name)}.git`;
      await execLocal('git', ['-C', workPath, 'push', '-u', pushUrl, `HEAD:refs/heads/${branchName}`], GIT);
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
          `**Pull request opened** (${match.name}): ${pr.htmlUrl}\n\n**Summary:** ${issueSummary}\n\n---\n\n_(Agent output length ${out.length} chars, truncated in PR body if needed.)_`
        )
      );
    } else {
      throw new Error(`pr-pipeline: internal: unsupported vcs ${vcs.provider}`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`pr-pipeline: failed for ${issueKey} / ${match.name}: ${msg}`);
    await jira
      .addComment(issueKey, stampJiraPr(`**pr-pipeline** (${match.name}): failed — \`${msg}\``))
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
  }
}

/** Thin adapter: real Jira client or mock. */
