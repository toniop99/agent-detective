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
     * When true, log each agent progress message (streamed stdout lines / commentary)
     * at info level while the agent runs. Useful to confirm the agent is active and
     * not frozen, especially for slow models like Claude. Default false.
     */
    prDebug: z.boolean().default(false),
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
    /**
     * When true, append an analytics table to the Jira PR comment and PR body
     * showing wall time, API time, agentic turns, and token counts.
     * Metrics come from Claude's stream-json result event; non-Claude agents
     * only show wall time. Default false.
     */
    prAnalytics: z.boolean().default(false),
    /**
     * When true (default), Jira issue comments fetched by the jira-adapter are
     * included in the agent prompt as additional context. Set to false to
     * suppress them even when the adapter passes them.
     */
    includeIssueComments: z.boolean().default(true),
    /**
     * Opt-in triage step that runs a read-only agent against the repo BEFORE
     * creating a worktree or running the coding agent. If the agent determines
     * the ticket does not require a code change, the workflow posts a Jira
     * comment and exits early — saving worktree and coding-agent cost.
     * Fails open: errors or unparseable verdicts always proceed to coding.
     */
    triage: z
      .object({
        /** When true, enable the triage step. Default false (opt-in). */
        enabled: z.boolean().default(false),
        /** Agent ID for triage (e.g. `'claude'`). Falls back to `prAgent` then app default. */
        agent: z.string().min(1).optional(),
        /** Model override for the triage call (e.g. `'claude-haiku-4-5-20251001'` for cheap triage). */
        model: z.string().min(1).optional(),
        /** Timeout in ms for the triage agent call. Default 60 000 (1 minute). */
        timeoutMs: z.number().int().positive().default(60_000),
        /** Extra instructions appended to the triage prompt for domain-specific guidance. */
        customPrompt: z.string().optional(),
      })
      .default({ enabled: false, timeoutMs: 60_000 }),
    /**
     * Opt-in image passing: download image attachments from the Jira ticket and
     * pass them to the agent (only supported by the `claude` adapter via `--input-file`).
     * Other agents receive a text-only list of attachment filenames. Default disabled.
     */
    images: z
      .object({
        /** When true, enable image downloading and passing. Default false (opt-in). */
        enabled: z.boolean().default(false),
        /** Maximum number of images to download. Default 5. */
        maxCount: z.number().int().positive().default(5),
        /** Maximum total bytes to download across all images. Default 10 MB. */
        maxTotalBytes: z.number().int().positive().default(10 * 1024 * 1024),
      })
      .default({ enabled: false, maxCount: 5, maxTotalBytes: 10_485_760 }),
  })
  .strict();

export type PrPipelineOptions = z.infer<typeof prPipelineOptionsSchema>;
