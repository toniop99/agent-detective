import { z } from 'zod';

/** Options for the PR-pipeline plugin (Jira + git + VCS). */
export const prPipelineOptionsSchema = z
  .object({
    /** When false, the plugin loads but does not register the PR workflow service. */
    enabled: z.boolean().default(true),
    /**
     * Prepended to the Jira issue key for the git feature branch, e.g. `hotfix/`
     * + `LLO-12` => `hotfix/LLO-12`.
     */
    prBranchPrefix: z.string().default('hotfix/'),
    /**
     * Title for the host pull request. `{{key}}` and `{{summary}}` are
     * substituted.
     */
    prTitleTemplate: z.string().default('[{{key}}] {{summary}}'),
    /**
     * When true, skip `git push` and the host PR API, and post a Jira comment
     * describing the branch that would be used (safe for evaluation).
     */
    prDryRun: z.boolean().default(true),
    /**
     * Agent to use for the coding step (e.g. `'claude'`, `'cursor'`, `'opencode'`).
     * When omitted, the app-wide `agent` config (or `AGENT` env var) applies.
     */
    prAgent: z.string().min(1).optional(),
    /**
     * Subprocess timeout (ms) for the write-mode agent step in this workflow only.
     * When omitted, the app-wide `agents.runner.timeoutMs` applies (default 120_000).
     */
    prAgentTimeoutMs: z.number().int().positive().optional(),
    /**
     * GitHub personal access token (classic or fine-grained) for `git push` and
     * REST. Overridden by `GITHUB_TOKEN` or `GH_TOKEN` when set.
     */
    githubToken: z.string().min(1).optional(),
    /**
     * Bitbucket **repository or workspace access token** (REST: `Authorization: Bearer`, Git: `x-token-auth` in URL). Overridden by `BITBUCKET_TOKEN` when set. When present, this **replaces** app-password auth.
     */
    bitbucketToken: z.string().min(1).optional(),
    /**
     * Bitbucket Cloud **username** (not email) used in the Git push URL.
     * Overridden by `BITBUCKET_USERNAME` when set. Ignored when
     * `bitbucketToken` / `BITBUCKET_TOKEN` is available.
     */
    bitbucketUsername: z.string().min(1).optional(),
    /**
     * Bitbucket Cloud **email address** used for REST API Basic auth.
     * New Bitbucket API tokens require email for API calls but username for Git.
     * When unset, `bitbucketUsername` is used as a fallback (works for old app passwords).
     * Overridden by `BITBUCKET_EMAIL` when set.
     */
    bitbucketEmail: z.string().min(1).optional(),
    /**
     * Bitbucket Cloud **app password or API token** paired with `bitbucketUsername` / `bitbucketEmail`.
     * New Bitbucket API tokens (Personal settings → API tokens): set this to the token value,
     * `bitbucketUsername` to your Bitbucket username (for Git), and `bitbucketEmail` to your
     * Bitbucket email (for REST API). Overridden by `BITBUCKET_APP_PASSWORD` when set.
     * Ignored when a Bitbucket access token (`bitbucketToken` / `BITBUCKET_TOKEN`) is set.
     */
    bitbucketAppPassword: z.string().min(1).optional(),
    /**
     * Shell commands executed in the worktree (cwd = worktree root) after checkout
     * and before the agent runs. Use `{{mainPath}}` to reference the original repo.
     * Each command runs via `sh -c`; failures are logged as warnings but do not
     * abort the workflow.
     */
    worktreeSetupCommands: z.array(z.string()).default([]),
  })
  .strict();

export type PrPipelineOptions = z.infer<typeof prPipelineOptionsSchema>;
