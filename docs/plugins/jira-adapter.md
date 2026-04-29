---
title: "Jira adapter"
description: Configure the Jira adapter for webhooks, OAuth 2.0 (3LO), label matching, and PR fan-out.
sidebar:
  order: 3
---

# Jira adapter (`@agent-detective/jira-adapter`)

Bundled plugin that receives **Jira webhooks**, matches issues to local repos via **labels**, and fans out **code analysis** tasks or the **PR pipeline** when `@agent-detective/pr-pipeline` is installed.

## How webhooks, OAuth, and trigger phrases fit together

These solve different problems:

| Piece | Direction | Role |
|-------|------------|------|
| **Jira webhook** (Jira → you) | Jira **POSTs** to your server | Delivers issue/comment events. This is independent from OAuth or API-token auth. |
| **OAuth 2.0 (3LO)** (you → Jira) | Your server **calls** Jira REST API | Authenticates **reads and writes** (comments, issue fetches, attachments) without a long-lived personal API token. |
| **`#agent-detective analyze` / `pr`** | Inside your app | After a **comment webhook** arrives, the adapter parses the comment body and decides analyze vs PR. OAuth does not replace trigger phrases. |

So: **webhooks** bring work in; **OAuth (or Basic)** lets the server act on Jira; **trigger phrases** decide what to do with a comment event.

## Requirements

- **`local-repos-plugin`** must be enabled and configured with `repos[]` whose **`name`** values match Jira issue **labels** (case-insensitive).
- **`@agent-detective/pr-pipeline`** is optional; without it, PR trigger comments receive a Jira comment explaining that the PR workflow is not loaded.

## Webhook endpoint

Webhook URL (fixed by plugin prefixing):

- `POST …/plugins/agent-detective-jira-adapter/webhook/jira`

You configure this webhook in Jira (system webhooks or Automation “Send web request”).

## Auth options: Basic vs OAuth 2.0 (3LO)

The adapter supports two modes. It **auto-detects** which one to use:

- **OAuth** when `oauthClientId` + `oauthClientSecret` + `oauthRefreshToken` are set (and `cloudId` is set).
- Otherwise **Basic** when `baseUrl` + `email` + `apiToken` are set.

### Basic (API token) — simplest path

1. Create a dedicated Atlassian bot user (recommended for comment identity).
2. Create an Atlassian API token for that user.
3. Set one of:
   - `baseUrl`, `email`, `apiToken` in `config/local.json`, or
   - `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` as environment variables.

Comments and mutations are attributed to that Atlassian account.

### OAuth 2.0 (3LO) — preferred for a distributable integration

Create an OAuth integration in the Atlassian developer console, set the callback URL, then use the adapter’s OAuth routes to obtain tokens.

#### 1. Configure OAuth settings (no tokens yet)

Set these (in `config/local.json` or env):

| Field | Env var | Notes |
|------|---------|------|
| `oauthClientId` | `JIRA_OAUTH_CLIENT_ID` | From Atlassian developer console |
| `oauthClientSecret` | `JIRA_OAUTH_CLIENT_SECRET` | Secret |
| `oauthRedirectBaseUrl` | `JIRA_OAUTH_REDIRECT_BASE_URL` | Public origin, e.g. `https://abc.ngrok-free.app` |
| `cloudId` | `JIRA_CLOUD_ID` | Either known ahead of time, or chosen from callback output |

The plugin mounts these routes as soon as the 3 required OAuth config fields are present:

- `GET …/plugins/agent-detective-jira-adapter/oauth/start`
- `GET …/plugins/agent-detective-jira-adapter/oauth/callback`

#### 2. Start the browser install

Open:

`https://<your-public-host>/plugins/agent-detective-jira-adapter/oauth/start`

You are redirected to Atlassian, approve access, then land on `/oauth/callback?code=…&state=…`.

#### 3. Tokens are **not** saved automatically

The server **does not** write `local.json` or env variables for you. You copy the callback JSON into config/env:

| From callback JSON | Into config/env |
|--------------------|----------------|
| `access_token` | `apiToken` / `JIRA_API_TOKEN` (treated as current access token) |
| `refresh_token` | `oauthRefreshToken` / `JIRA_OAUTH_REFRESH_TOKEN` |
| `cloud_id` (or select from `resources[]`) | `cloudId` / `JIRA_CLOUD_ID` |

Restart the process after updating config/env.

#### 4. Refresh token rotation

Atlassian uses rotating refresh tokens. When a refresh returns a new refresh token, logs warn you to update `JIRA_OAUTH_REFRESH_TOKEN` (or `config/local.json`). Nothing auto-persists.

## OAuth troubleshooting (quick)

| Symptom | Likely cause | Fix |
|--------|--------------|-----|
| Hitting `/oauth/start` returns 404 | OAuth routes are not registered | Set `oauthClientId`, `oauthClientSecret`, and `oauthRedirectBaseUrl` (or the `JIRA_OAUTH_*` env vars) and restart. |
| Callback returns `resources[]` with multiple entries but no `cloud_id` | The token grant covers multiple sites | Pick the correct site `id` from `resources[]` and set `cloudId` / `JIRA_CLOUD_ID`, then restart. |
| Startup fails: “OAuth configured but cloudId is missing” | `cloudId` is required for OAuth calls | Set `cloudId` / `JIRA_CLOUD_ID` to the site id from accessible-resources. |
| Logs warn about a new refresh token | Rotating refresh tokens | Update `JIRA_OAUTH_REFRESH_TOKEN` (or `config/local.json`) to the new value; nothing auto-persists. |
| 401/403 from Jira during API calls | Access token expired / revoked, or user permissions insufficient | The adapter will try refresh+retry once. If it keeps failing, re-run OAuth and confirm the bot user has Jira permissions for the project. |

## Comment identity

Jira attributes comments to the authenticated **user** (Basic API token user or the user who completed OAuth). To make comments recognizable, use a dedicated bot Atlassian user with a clear display name and avatar, and run OAuth consent as that user.

## Structured comment metadata (Jira Automation)

Set **`structuredCommentMetadata`: `true`** on the plugin to append a fenced JSON block after the analysis Markdown (still before the adapter footer). The payload uses schema **`agent-detective/jira-comment-metadata/v1`** with **`taskId`**, **`issueKey`**, optional **`matchedRepo`**, and **`completedAt`**. Use it from **Jira Automation** (smart value → JSON parse) or external scripts without scraping free-form analysis text.

## Optional subtasks after analysis (`taskSpawnOnComplete`)

When **`taskSpawnOnComplete`** is **`subtasks`**, the adapter creates Jira **subtasks** under the parent issue after each successful analysis (`TASK_COMPLETED`), **before** posting the usual result comment. This requires **host SQLite persistence** enabled in app config (`persistence.enabled` + `persistence.databasePath`) so idempotency survives restarts.

- **`taskSpawnMaxPerCompletion`** (default **3**) caps how many subtasks are created per task.
- **`taskSpawnSubtaskSummaryTemplate`** / **`taskSpawnSubtaskDescriptionTemplate`** support **`{result}`** placeholder (default one template-driven subtask when JSON merge is off).
- **`taskSpawnMergeAgentJson`**: when true, the first fenced JSON code block in the agent output may supply `{ "subtasks": [ { "summary", "description" } ] }` (capped by max).
- **`taskSpawnAllowedProjectKeys`**: when set, spawn is skipped unless the parent issue’s Jira **project key** is listed.

OAuth / Basic tokens need permission to **create issues** in the project. **`mockMode`** still exercises dedupe + mock subtask keys without calling Jira.

## See also

- [Application configuration](../config/configuration.md) (env whitelist)
- Generated option reference: [docs/reference/generated/plugin-options.md](../reference/generated/plugin-options.md)

