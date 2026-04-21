# Changelog

## Config (breaking)

The following top-level and plugin fields were **removed** (they were ignored by older builds or unsafe to keep in JSON):

- **Top level:** `model` (use `agents.<id>.defaultModel` or `AGENTS_*_MODEL` env), `adapters` (use `plugins` / the server `GET /` and `GET /api` `plugins` list).
- **local-repos-plugin:** `validation.validateOnStartup` (only `failOnMissing` is used), `discovery`, nested `repoContext.summaryGeneration` (use top-level `summaryGeneration`).
- **jira-adapter:** `webhookPath` (path is fixed under `/plugins/.../webhook/jira`).

**Jira credentials:** do not keep `apiToken` / `email` / `baseUrl` in committed example files; set **`JIRA_API_TOKEN`**, **`JIRA_EMAIL`**, **`JIRA_BASE_URL`** in production. Rotate any token that was ever in a local file.

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
