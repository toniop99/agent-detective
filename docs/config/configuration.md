# Application configuration

**Short index:** [configuration-hub.md](configuration-hub.md) (load order, top-level keys, where to look next).

Configuration is loaded at process startup from JSON files under the **`config/`** directory relative to the current working directory (`process.cwd()`), then merged with a small **environment whitelist** (no generic nested env keys such as `FOO__bar__baz`).

## Files

| File | Role |
|------|------|
| `config/default.json` | Base settings (checked into the repo). |
| `config/local.json` | Optional overrides (typically gitignored). |

`local.json` is **deep-merged** over `default.json`. Arrays are replaced, not concatenated.

## Core env whitelist

These variables override or extend the merged JSON when set:

| Variable | Effect |
|----------|--------|
| `PORT` | HTTP listen port (integer). |
| `AGENT` | Default agent id (e.g. `opencode`). |
| `AGENTS_OPENCODE_MODEL`, `AGENTS_CLAUDE_MODEL`, `AGENTS_CURSOR_MODEL` | Per-agent default model. |
| `AGENTS_<ID>_MODEL` | Any agent id in uppercase letters/digits (e.g. `AGENTS_OPENCODE_MODEL`). |
| `AGENTS_RUNNER_TIMEOUT_MS` | `agents.runner.timeoutMs` (agent child process + exec timeout, ms). |
| `AGENTS_RUNNER_MAX_BUFFER_BYTES` | `agents.runner.maxBufferBytes` |
| `AGENTS_RUNNER_POST_FINAL_GRACE_MS` | `agents.runner.postFinalGraceMs` (SIGTERM delay before kill). |
| `AGENTS_RUNNER_FORCE_KILL_DELAY_MS` | `agents.runner.forceKillDelayMs` (after SIGTERM, before SIGKILL). |
| `OBSERVABILITY_REQUEST_LOGGER_EXCLUDE_PATHS` | Comma-separated paths; merged into `observability.requestLogger.excludePaths` (default logs skip `/api/health` and `/api/metrics`). |
| `DOCS_AUTH_REQUIRED` | `true` / `false` — require `X-API-KEY` for `/docs`. |
| `DOCS_API_KEY` | API key value when docs auth is enabled. |

`RunAgentOptions` (orchestrator, Core API) supports **`threadId`**: passed to each agent’s shell command for session resume (opencode, claude, cursor). For HTTP, set `options.threadId` on `POST /api/agent/run` or `context.threadId` on `POST /api/events`.

## Observability log level

`@agent-detective/observability` reads **`OBSERVABILITY_LOG_LEVEL`**. If you set **`LOG_LEVEL`** to `debug`, `info`, `warn`, or `error` and leave `OBSERVABILITY_LOG_LEVEL` unset, the app mirrors `LOG_LEVEL` into `OBSERVABILITY_LOG_LEVEL` before observability starts.

## Plugin env whitelist (first-party)

Env is merged **only into an existing** `plugins[]` entry with the matching `package` string (plugins are not auto-added from env alone).

| Variable | Target |
|----------|--------|
| `JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_BASE_URL` | Options for `@agent-detective/jira-adapter` (`apiToken`, `email`, `baseUrl`). |
| `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SIGNING_SECRET`, `LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET`, `LINEAR_OAUTH_REDIRECT_BASE_URL`, `LINEAR_OAUTH_REFRESH_TOKEN` | Options for `@agent-detective/linear-adapter` (`apiKey`, `webhookSigningSecret`, OAuth fields). See [plugins/linear-adapter.md](../plugins/linear-adapter.md). |
| `JIRA_AUTO_ANALYSIS_COOLDOWN_MS` | `options.autoAnalysisCooldownMs` on the Jira plugin (default 600000). |
| `JIRA_MISSING_LABELS_REMINDER_COOLDOWN_MS` | `options.missingLabelsReminderCooldownMs` (default 60000). |
| `REPO_CONTEXT_GIT_LOG_MAX_COMMITS` | Positive integer → `options.repoContext.gitLogMaxCommits` (local-repos). |
| `REPO_CONTEXT_GIT_COMMAND_TIMEOUT_MS` | `options.repoContext.gitCommandTimeoutMs` |
| `REPO_CONTEXT_GIT_MAX_BUFFER_BYTES` | `options.repoContext.gitMaxBufferBytes` |
| `REPO_CONTEXT_DIFF_FROM_REF` | `options.repoContext.diffFromRef` (e.g. `HEAD~5`) |
| `SUMMARY_MAX_OUTPUT_CHARS` | `options.summaryGeneration.maxOutputChars` |
| `GITHUB_TOKEN`, `GH_TOKEN` | `options.githubToken` on `@agent-detective/pr-pipeline` (if that plugin is listed). `GITHUB_TOKEN` wins over `GH_TOKEN`, then file. At **runtime** the same order applies. |
| `BITBUCKET_TOKEN` | `options.bitbucketToken` on pr-pipeline (access token; env overrides file). |
| `BITBUCKET_USERNAME`, `BITBUCKET_APP_PASSWORD` | `options.bitbucketUsername` / `options.bitbucketAppPassword` (app password; env overrides file). Ignored if a Bitbucket access token is set. |

For a step-by-step local webhook test (tunnel, labels, smoke script), see [e2e/jira-manual-e2e.md](../e2e/jira-manual-e2e.md). For **Jira → pull request** (pr-pipeline), see [e2e/jira-pr-pipeline-manual-e2e.md](../e2e/jira-pr-pipeline-manual-e2e.md).

## PR pipeline (`@agent-detective/pr-pipeline`)

Jira comment (default phrase `#agent-detective pr`, configurable as `prTriggerPhrase` on the Jira plugin) can trigger an **isolated git worktree**, a **write-mode** agent run, **commit + push**, and a **pull request** on **GitHub** or **Bitbucket Cloud** — when `vcs` is set on the matching local-repos repo and credentials are available.

Set **`enabled`: false** in this plugin’s `options` to keep the pr-pipeline entry in config but not register the PR workflow (same idea as the Jira adapter’s `enabled` flag).

**Extra context in the same comment:** any text in the Jira comment **after removing the first occurrence of the PR trigger phrase** (case-insensitive) is passed to the agent as *Additional context from the Jira comment* (e.g. file paths, commit hashes, or a short error description), in addition to the issue description. Example: `#agent-detective pr this error is related to the changes in authentication.php in commit 751b957`.

**Jira ticket comment history:** when `fetchIssueComments: true` is set on the `@agent-detective/jira-adapter` plugin, the adapter fetches all comments on the Jira ticket at PR-trigger time, discards any posted by the app itself (identified by the `agent-detective · ad-v1` marker or the configured `jiraUser` identity), and passes the remaining comments to the pr-pipeline. The pr-pipeline includes them in the agent prompt as *Jira ticket comments (oldest to newest)* when `includeIssueComments: true` (the default). This gives the agent the full discussion context from the ticket — requirements clarifications, follow-ups, decisions — in addition to the issue description. Both options default to `false` / `true` respectively so no existing behaviour changes unless you opt in via `fetchIssueComments: true`.

**Triage (opt-in):** set `triage.enabled: true` under `@agent-detective/pr-pipeline` options to run a read-only agent call *before* any worktree is created. The triage agent fetches the latest remote state (`origin/{prBase}`), reads the codebase, and decides whether the Jira ticket actually requires a code change. If it determines it does not (e.g. the issue is a data problem, user misunderstanding, or already fixed), it posts a Jira comment with the reasoning and exits early — saving worktree creation and coding-agent cost. If the triage fails or times out, the workflow **proceeds** (fail-open). Config options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `triage.enabled` | boolean | `false` | Enable the triage step |
| `triage.agent` | string | — | Agent ID for triage (falls back to `prAgent` then app default) |
| `triage.model` | string | — | Model override, e.g. `claude-haiku-4-5-20251001` for cheap/fast triage |
| `triage.timeoutMs` | number | `60000` | Timeout in ms for the triage agent call |
| `triage.customPrompt` | string | — | Extra instructions appended to the triage prompt |

**Precedence (always):** values from **environment variables** override the same keys in **merged JSON** (`default.json` + `local.json`) for both the [plugin env merge](#plugin-env-whitelist-first-party) at load time and, for tokens, the [runtime resolution](#host-credentials-precedence) used when the job runs. Prefer secrets in **env** in production; use `config/local.json` (gitignored) for local dev if you accept file-based secrets.

### Host credentials precedence

| Secret | First wins | Then | Then |
|--------|------------|------|------|
| GitHub token | `GITHUB_TOKEN` | `GH_TOKEN` | `plugins[].options.githubToken` for `@agent-detective/pr-pipeline` |
| Bitbucket legacy access token (`x-token-auth`) | `BITBUCKET_TOKEN` | | `options.bitbucketToken` in JSON for pr-pipeline |
| Bitbucket username + credential (API token or app password) | `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` | | `bitbucketUsername` + `bitbucketAppPassword` in JSON |

**If `BITBUCKET_TOKEN` is set, the username+credential path is not used.**

Empty or whitespace-only values are ignored; the next source in the chain is used.

**Bitbucket — new API token (recommended):** Bitbucket now issues **API tokens** under *Personal settings → API tokens*. These use your Bitbucket **username** + the token value as HTTP Basic credentials — the same format as the old app passwords. Set:
```
BITBUCKET_USERNAME=<your-bitbucket-username>   # not your email
BITBUCKET_APP_PASSWORD=<your-api-token>
```
The token needs these scopes:
- `read:repository:bitbucket` — read repo contents
- `write:repository:bitbucket` — git push
- `read:pullrequest:bitbucket` — required by the Bitbucket PR API even when only creating PRs
- `write:pullrequest:bitbucket` — create pull requests

**Bitbucket — legacy access token (when `BITBUCKET_TOKEN` or `bitbucketToken` is set):** REST calls use `Bearer` and Git uses `x-token-auth` in the URL. This is for older workspace/repository access tokens, not the new API tokens.

**Per-repo `vcs`** (under `local-repos` `repos[]`) selects the host; **branch prefix and base** can be set per repo (`prBranchPrefix`, `prBaseBranch`).

- GitHub: `"vcs": { "provider": "github", "owner": "my-org", "name": "my-repo" }`
- Bitbucket: `"vcs": { "provider": "bitbucket", "owner": "<workspace>", "name": "<repo-slug>" }`

### End-to-end flow

```mermaid
flowchart LR
  A[Jira: comment with PR phrase] --> B[Jira adapter: match labels to repos]
  B --> C[pr-pipeline: enqueue]
  C --> D[Worktree from base branch]
  D --> E[Agent write in worktree]
  E --> F[Commit]
  F --> G{prDryRun?}
  G -->|yes| H[Jira: dry-run summary]
  G -->|no| I{host}
  I -->|github| J[push + GitHub API PR]
  I -->|bitbucket| K[push + Bitbucket API PR]
  J --> L[Jira: PR link]
  K --> L
```

1. A matching **label** maps the issue to a **local-repos** entry (`path` + optional `vcs` / `prBaseBranch` / `prBranchPrefix`).  
2. The pipeline creates a **temporary worktree**, runs any **`worktreeSetupCommands`** (install deps, copy gitignored files, etc.), runs the **agent** with the Jira text, **commits** if there are changes. The agent used is determined by `prAgent` (plugin option) → app-level `agent` config / `AGENT` env var → `opencode` (default).  
3. If **`prDryRun`** is true (default in `config/default.json`), it posts a Jira note only (no push).  
4. If not dry-run, it **pushes** to `origin` on the chosen host and **opens a PR** using the **resolved tokens** above.  
5. A **Jira comment** includes the PR URL or an error.

Option reference: [docs/reference/generated/plugin-options.md](../reference/generated/plugin-options.md) (block **@agent-detective/pr-pipeline**, anchor `pr-pipeline`).

## Validation

After merge and env application, the top-level config is validated with **Zod** (`src/config/schema.ts`). Invalid shapes cause startup to fail with an error message.

## Plugin option schemas (generated)

Zod option schemas for bundled plugins drive both runtime validation in `register()` and generated reference docs:

- [docs/reference/generated/plugin-options.md](../reference/generated/plugin-options.md)

Regenerate after editing the bundled plugins’ Zod schemas (see [architecture-layering.md](../architecture/architecture-layering.md) for paths; e.g. `packages/jira-adapter/src/application/options-schema.ts`, `packages/linear-adapter/src/application/options-schema.ts`, `packages/pr-pipeline/src/application/options-schema.ts`, `packages/local-repos-plugin/src/application/options-schema.ts`):

```bash
pnpm docs:plugins
```

CI enforces that the generated file is up to date (`pnpm docs:plugins:check`).

## See also

- [Configuration overview (hub)](configuration-hub.md)
- [Upgrading and releases](../operator/upgrading.md)
- [Docker environment variables](../operator/docker.md#production-style-run-single-host)
- [Development guide](../development/development.md#configuration)
- [Plugin development](../plugins/plugins.md#3-schema-system)
