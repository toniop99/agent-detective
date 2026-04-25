# Changelog

## Config (breaking) — pr-pipeline worktree setup

- **`worktreeInstallDeps`** (boolean, previously defaulted to `true`) has been **removed**. Replace it with **`worktreeSetupCommands`** (array of shell strings, defaults to `[]`). Each command runs via `sh -c` with `cwd` set to the worktree root; the token `{{mainPath}}` expands to the source repo path. Failures are non-fatal (logged as warnings). Migration example:
  ```json
  "worktreeSetupCommands": [
    "pnpm install --frozen-lockfile",
    "cp {{mainPath}}/docker/.env docker/.env"
  ]
  ```
  The old automatic lock-file detection (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `composer.lock`, `go.mod`) is no longer performed; add the relevant install command explicitly if your repo needs it.

## Config (breaking)

The following top-level and plugin fields were **removed** (they were ignored by older builds or unsafe to keep in JSON):

- **Top level:** `model` (use `agents.<id>.defaultModel` or `AGENTS_*_MODEL` env), `adapters` (use `plugins` / the server `GET /` and `GET /api` `plugins` list).
- **local-repos-plugin:** `validation.validateOnStartup` (only `failOnMissing` is used), `discovery`, nested `repoContext.summaryGeneration` (use top-level `summaryGeneration`).
- **jira-adapter:** `webhookPath` (path is fixed under `/plugins/.../webhook/jira`).

**Jira credentials:** do not keep `apiToken` / `email` / `baseUrl` in committed example files; set **`JIRA_API_TOKEN`**, **`JIRA_EMAIL`**, **`JIRA_BASE_URL`** in production. Rotate any token that was ever in a local file.

## pr-pipeline: configurable agent

The PR pipeline no longer hardcodes `opencode` as the coding agent. Agent selection now follows a three-level precedence:

1. **`prAgent`** option on `@agent-detective/pr-pipeline` (per-plugin override).
2. App-level **`agent`** config field or **`AGENT`** env var (global default).
3. `opencode` (built-in fallback, unchanged behaviour when nothing is set).

### New keys (defaults match previous hardcoded behavior)

- **`agents.runner`:** `timeoutMs`, `maxBufferBytes`, `postFinalGraceMs`, `forceKillDelayMs` — see `config/local.example.json`.
- **Env:** `AGENTS_RUNNER_TIMEOUT_MS`, `AGENTS_RUNNER_MAX_BUFFER_BYTES`, `AGENTS_RUNNER_POST_FINAL_GRACE_MS`, `AGENTS_RUNNER_FORCE_KILL_DELAY_MS`, `OBSERVABILITY_REQUEST_LOGGER_EXCLUDE_PATHS` (comma-separated paths).
- **Jira (options or env `JIRA_AUTO_ANALYSIS_COOLDOWN_MS`, `JIRA_MISSING_LABELS_REMINDER_COOLDOWN_MS`):** `autoAnalysisCooldownMs`, `missingLabelsReminderCooldownMs`.
- **local-repos `repoContext` (or env `REPO_CONTEXT_GIT_COMMAND_TIMEOUT_MS`, `REPO_CONTEXT_GIT_MAX_BUFFER_BYTES`, `REPO_CONTEXT_DIFF_FROM_REF`):** `gitCommandTimeoutMs`, `gitMaxBufferBytes`, `diffFromRef`.
- **local-repos `summaryGeneration` (or `SUMMARY_MAX_OUTPUT_CHARS` env):** `maxOutputChars`.
- **Observability:** `observability.requestLogger.excludePaths`.

Plugin option objects for bundled plugins are now validated with **`.strict()`**; unknown keys fail at plugin load with a Zod error.

## API

- **`GET /` and `GET /api` root payload:** `adapters` was replaced with **`plugins`** (package names from config).

---

See also [migration.md](migration.md) and [configuration.md](configuration.md).
