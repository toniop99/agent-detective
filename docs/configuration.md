# Application configuration

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
| `AGENTS_OPENCODE_MODEL`, `AGENTS_CLAUDE_MODEL`, `AGENTS_GEMINI_MODEL` | Per-agent default model. |
| `AGENTS_<ID>_MODEL` | Any agent id in uppercase letters/digits (e.g. `AGENTS_OPENCODE_MODEL`). |
| `AGENTS_RUNNER_TIMEOUT_MS` | `agents.runner.timeoutMs` (agent child process + exec timeout, ms). |
| `AGENTS_RUNNER_MAX_BUFFER_BYTES` | `agents.runner.maxBufferBytes` |
| `AGENTS_RUNNER_POST_FINAL_GRACE_MS` | `agents.runner.postFinalGraceMs` (SIGTERM delay before kill). |
| `AGENTS_RUNNER_FORCE_KILL_DELAY_MS` | `agents.runner.forceKillDelayMs` (after SIGTERM, before SIGKILL). |
| `OBSERVABILITY_REQUEST_LOGGER_EXCLUDE_PATHS` | Comma-separated paths; merged into `observability.requestLogger.excludePaths` (default logs skip `/api/health` and `/api/metrics`). |
| `DOCS_AUTH_REQUIRED` | `true` / `false` — require `X-API-KEY` for `/docs`. |
| `DOCS_API_KEY` | API key value when docs auth is enabled. |

## Observability log level

`@agent-detective/observability` reads **`OBSERVABILITY_LOG_LEVEL`**. If you set **`LOG_LEVEL`** to `debug`, `info`, `warn`, or `error` and leave `OBSERVABILITY_LOG_LEVEL` unset, the app mirrors `LOG_LEVEL` into `OBSERVABILITY_LOG_LEVEL` before observability starts.

## Plugin env whitelist (first-party)

Env is merged **only into an existing** `plugins[]` entry with the matching `package` string (plugins are not auto-added from env alone).

| Variable | Target |
|----------|--------|
| `JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_BASE_URL` | Options for `@agent-detective/jira-adapter` (`apiToken`, `email`, `baseUrl`). |
| `JIRA_AUTO_ANALYSIS_COOLDOWN_MS` | `options.autoAnalysisCooldownMs` on the Jira plugin (default 600000). |
| `JIRA_MISSING_LABELS_REMINDER_COOLDOWN_MS` | `options.missingLabelsReminderCooldownMs` (default 60000). |
| `REPO_CONTEXT_GIT_LOG_MAX_COMMITS` | Positive integer → `options.repoContext.gitLogMaxCommits` (local-repos). |
| `REPO_CONTEXT_GIT_COMMAND_TIMEOUT_MS` | `options.repoContext.gitCommandTimeoutMs` |
| `REPO_CONTEXT_GIT_MAX_BUFFER_BYTES` | `options.repoContext.gitMaxBufferBytes` |
| `REPO_CONTEXT_DIFF_FROM_REF` | `options.repoContext.diffFromRef` (e.g. `HEAD~5`) |
| `SUMMARY_MAX_OUTPUT_CHARS` | `options.summaryGeneration.maxOutputChars` |

For a step-by-step local webhook test (tunnel, labels, smoke script), see [jira-manual-e2e.md](jira-manual-e2e.md).

## Validation

After merge and env application, the top-level config is validated with **Zod** (`src/config/schema.ts`). Invalid shapes cause startup to fail with an error message.

## Plugin option schemas (generated)

Zod option schemas for bundled plugins drive both runtime validation in `register()` and generated reference docs:

- [docs/generated/plugin-options.md](generated/plugin-options.md)

Regenerate after editing `packages/*/src/options-schema.ts`:

```bash
pnpm docs:plugins
```

CI enforces that the generated file is up to date (`pnpm docs:plugins:check`).

## See also

- [Docker environment variables](docker.md#production-style-run-single-host)
- [Development guide](development.md#configuration)
- [Plugin development](plugins.md#3-schema-system)
