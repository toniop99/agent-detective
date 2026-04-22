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
     * Bitbucket Cloud **username** (not email) for HTTP Basic with an app
     * password. Overridden by `BITBUCKET_USERNAME` when set. Ignored when
     * `bitbucketToken` / `BITBUCKET_TOKEN` is available.
     */
    bitbucketUsername: z.string().min(1).optional(),
    /**
     * Bitbucket Cloud **app password** (create under Personal settings). Overridden
     * by `BITBUCKET_APP_PASSWORD` when set. Ignored when a Bitbucket access token is set.
     */
    bitbucketAppPassword: z.string().min(1).optional(),
  })
  .strict();

export type PrPipelineOptions = z.infer<typeof prPipelineOptionsSchema>;
