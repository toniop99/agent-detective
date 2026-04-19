# Manual E2E: Jira webhook → local server → repo context → comment

This guide walks through testing the full path locally, including how Jira Cloud reaches your machine, what to configure, and how to verify each step.

## Prerequisites (local machine)

1. **Node 24+** and **pnpm** — see [development.md](development.md).
2. **Agent CLI** on your `PATH` for dev (`pnpm dev`): install [OpenCode](https://opencode.ai/docs) with `npm install -g opencode-ai` (or use another registered agent with credentials configured).
3. **LLM / provider credentials** for that agent (environment variables or OpenCode config).
4. A **git checkout** on disk you can point the local-repos plugin at (your “test repo” containing the error or stack trace you will paste into Jira).
5. **Jira Cloud** access to create **webhooks** (often site admin).

## How Jira reaches localhost

Jira Cloud sends **HTTPS POST** requests to a **public URL**. Your local `agent-detective` listens on `http://127.0.0.1:3001` by default.

1. Install a tunnel client (**ngrok**, **Cloudflare Tunnel**, **localtunnel**, etc.).
2. Start a tunnel to **`http://127.0.0.1:3001`** (or your `PORT`).
3. In Jira, register the webhook URL exactly as:

`https://<tunnel-host>/plugins/agent-detective-jira-adapter/webhook/jira`

4. Subscribe at least to **Issue: created** (and optionally **Issue: updated** for acknowledge behavior).

No path prefix beyond `/plugins/...` is required unless you put a reverse proxy in front.

## Configuration

Use **`config/local.json`** (merged over `default.json`, typically gitignored) so secrets stay off git. Copy from [config/local.example.json](../config/local.example.json).

### Local repos plugin

- Set **`repos`** with an absolute **`path`** and a short stable **`name`** (e.g. `my-test-repo`).
- In Jira, add an issue **label** identical to that **`name`** so [findDirectMatch](../packages/local-repos-plugin/src/discovery.ts) selects the repo without relying on agent discovery.

### Jira adapter

- **`webhookPath`:** default `/plugins/agent-detective-jira-adapter/webhook/jira` matches the registered route.
- **`webhookBehavior`:** default maps **`jira:issue_created`** → **`analyze`** ([default.json](../config/default.json)).
- **`mockMode: true`:** analysis runs; “comments” are logged as **`[MOCK] Added comment...`** ([mock-jira-client.ts](../packages/jira-adapter/src/mock-jira-client.ts)).
- **`mockMode: false`:** posts real comments via **Jira REST API v3** ([real-jira-client.ts](../packages/jira-adapter/src/real-jira-client.ts)). You must set **`baseUrl`**, **`email`**, and **`apiToken`** (or **`JIRA_BASE_URL`**, **`JIRA_EMAIL`**, **`JIRA_API_TOKEN`** in the environment — see [env-whitelist.ts](../src/config/env-whitelist.ts)).

Optional: override **`analysisPrompt`** on `jira:issue_created` to steer the model toward root-cause analysis.

## Smoke test without Jira Cloud

With the server running (`pnpm dev`):

```bash
pnpm run jira:webhook-smoke
```

This POSTs [issue-created.json](../packages/jira-adapter/test/fixtures/issue-created.json) to the webhook. Expect **`{"status":"queued","taskId":...}`** and log lines for orchestration plus **`[MOCK]`** when `mockMode` is true.

Override URL:

```bash
JIRA_WEBHOOK_URL=https://your-tunnel.example/plugins/agent-detective-jira-adapter/webhook/jira pnpm run jira:webhook-smoke
```

## Jira Cloud checklist

| Check | Detail |
|-------|--------|
| Webhook URL | Tunnel HTTPS + path above |
| Events | Issue created (minimum) |
| Test issue | Summary/description describe the error; **label** = `repos[].name` |
| Server logs | Task id / issue key; agent start/finish |
| Mock comment | `[MOCK] Added comment to <KEY>:` when `mockMode: true` |
| Real comment | Issue **Comments** panel updates when `mockMode: false` and API token has permission |

## Security notes

- Webhook URLs are sensitive; rotate tunnel URLs if exposed.
- Incoming Jira webhooks are **not** cryptographically verified in this codebase yet; prefer private tunnels and least-privilege Jira tokens.

## Related docs

- [configuration.md](configuration.md) — config merge and env whitelist  
- [docker.md](docker.md) — running in containers  
- [development.md](development.md) — local dev and `mockMode` overview  
