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
3. In Jira, register the webhook URL (see the source-specific details below). The base path is always:

`https://<tunnel-host>/plugins/agent-detective-jira-adapter/webhook/jira`

4. Subscribe at least to **Issue: created** (and optionally **Issue: updated** for acknowledge behavior).

No path prefix beyond `/plugins/...` is required unless you put a reverse proxy in front.

### Which webhook source are you using?

Jira Cloud offers two ways to send HTTP requests when issues change. Both are supported; the only difference is **how the event name reaches us**. The adapter accepts all three signals listed in [`resolveWebhookEvent`](../packages/jira-adapter/src/jira-webhook-controller.ts) and normalizes them to the canonical `jira:*` form before routing.

| Source | Where Jira is configured | How the event arrives | What you do |
|---|---|---|---|
| **Native webhook** | Settings → System → WebHooks (site admin) | `body.webhookEvent = "jira:issue_created"` | Just point it at the base URL. Nothing else. |
| **Automation — "Automation format"** | Automation rule → Send web request → *Web request body: Automation format* | `body.issue_event_type_name = "issue_created"` (or `"issue_generic"` for most updates). **Body is the issue object directly at the top level**, not wrapped in `{ issue: … }`. | Append `?webhookEvent=jira:issue_created` to the URL (event name). The adapter auto-detects and wraps the bare-issue body — no template edits needed. |
| **Automation — "Jira format"** | Automation rule → Send web request → *Web request body: Jira format* | Body is `{ issue, user, timestamp }`; no event in body. | **Append `?webhookEvent=jira:issue_created` (or the matching value) to the URL**, one rule per event. |

Notes:

- **Automation-format bodies omit the envelope.** Jira Automation's "Automation format" default body expands `{{issue}}` at the top level, so the request looks like `{ self, id, key, fields, changelog, renderedFields }`. The adapter detects this via `key` + `fields` at the top level and auto-wraps it as `{ issue: { …bareIssue } }` before validation — see [`normalizeWebhookShape`](../packages/jira-adapter/src/webhook-handler.ts). You'll see `"shape":"bare-issue"` in the `Webhook payload accepted` log line when this triggers.
- **Automation format still doesn't include the event name by default.** The body contains the issue, but not the trigger. Prefer `?webhookEvent=…` on the URL or customize the action's "Custom data" to add `{"issue_event_type_name":"{{issueEventTypeName}}"}` — both are more explicit than relying on shape inference.
- **Payload-shape fallback.** When none of the explicit sources above provide an event, the adapter inspects the payload itself: a non-empty `changelog.items` array ⇒ `jira:issue_updated`, otherwise (issue envelope or bare-issue) ⇒ `jira:issue_created`. You'll see `Resolved webhook event from payload.shape: jira:issue_updated` in the logs when this kicks in. This is a safety net for Automation rules that forget the URL query — routing still works, but the log makes it obvious you should fix the rule for clarity.
- If the payload doesn't look like an issue event at all, the adapter resolves to `unknown` and falls back to `webhookBehavior.defaults`. Use the `Webhook payload accepted` summary line to diagnose.
- When the event comes from anywhere other than `body.webhookEvent`, you'll see a single `Resolved webhook event from <source>: jira:issue_created (raw="issue_created")` log line that tells you where we picked it up and what we normalized it to.
- Your `webhookBehavior.events` config stays in canonical form (`jira:issue_created`, `jira:issue_updated`, …) regardless of source — see [default.json](../config/default.json).

## Configuration

Use **`config/local.json`** (merged over `default.json`, typically gitignored) so secrets stay off git. Copy from [config/local.example.json](../config/local.example.json).

### Local repos plugin

- Set **`repos`** with an absolute **`path`** and a short stable **`name`** (e.g. `my-test-repo`).
- In Jira, add an issue **label** identical to that **`name`** — this is the only way the adapter links a ticket to a repo (see "Matching a ticket to a repository" below). Labels are matched case-insensitively against `repos[].name`.
- The plugin exposes a **`RepoMatcher`** service (`REPO_MATCHER_SERVICE` from `@agent-detective/types`) that the Jira adapter calls before dispatching any analysis. It returns the first configured repo whose `name` matches any of the issue's labels, or `null`.

### Jira adapter

- **`webhookPath`:** default `/plugins/agent-detective-jira-adapter/webhook/jira` matches the registered route.
- **`webhookBehavior`:** default maps **`jira:issue_created`** → **`analyze`** ([default.json](../config/default.json)).
- **`mockMode: true`:** analysis runs; “comments” are logged as **`[MOCK] Added comment...`** ([mock-jira-client.ts](../packages/jira-adapter/src/mock-jira-client.ts)).
- **`mockMode: false`:** posts real comments via **Jira REST API v3** using the [`jira.js`](https://www.npmjs.com/package/jira.js) SDK (`Version3Client`) — see [real-jira-client.ts](../packages/jira-adapter/src/real-jira-client.ts). You must set **`baseUrl`**, **`email`**, and **`apiToken`** (or **`JIRA_BASE_URL`**, **`JIRA_EMAIL`**, **`JIRA_API_TOKEN`** in the environment — see [env-whitelist.ts](../src/config/env-whitelist.ts)).
- **Comment formatting (Markdown → ADF):** the agent is prompted to return GitHub-flavored Markdown and the adapter converts it to [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) before posting — see [markdown-to-adf.ts](../packages/jira-adapter/src/markdown-to-adf.ts). Supported elements: headings, **bold**, *italic*, ~~strike~~, `inline code`, fenced code blocks with language, bullet / ordered / nested lists, blockquotes, links, horizontal rules, and hard breaks. HTML and tables are not supported and are rendered as plain text.

Optional: override **`analysisPrompt`** on `jira:issue_created` to steer the model toward root-cause analysis.

### Matching a ticket to a repository

The adapter uses **labels only** — no AI-driven guessing, no fallbacks — to
decide which repo a ticket belongs to. The rules:

- **On `jira:issue_created`**, the adapter looks at `issue.fields.labels` and
  asks the `RepoMatcher` service for a case-insensitive match against
  configured repo names.
  - **Match →** a `TASK_CREATED` event is emitted with `context.repoPath` and
    `context.cwd` pre-set to the matched repo, and `metadata.matchedRepo` set
    to its name. The agent never has to pick a repo itself.
  - **No match →** the adapter posts a single Markdown comment asking the
    reporter to add one of the configured labels, then exits. No task is
    created, so there is no agent run and no follow-up comment spam.
- **On `jira:issue_updated`**, the adapter inspects `changelog.items[]` for a
  `field: "labels"` entry and diffs `fromString`/`toString` to see which labels
  were *added* in this update.
  - **A matching label was added →** analysis runs, same path as `issue_created`
    with a match **unless** the issue already had a matching label *before*
    this update — see the dedup rule below.
  - **Nothing was added, or the added labels don't match →** the adapter stays
    silent. This keeps the ticket clean on unrelated field edits (status
    transitions, assignee changes, description tweaks, …).
- **Stateless dedup:** if the changelog's `fromString` for the `labels` field
  already contained a label that matches a configured repo, the adapter
  assumes the analysis already ran (on create, or on an earlier label-add) and
  skips re-analyzing. This prevents comment spam when users curate labels on
  an already-matched ticket. Re-analysis only happens when the **first**
  matching label is added — never on a second/third matching label or on
  label removals.
- Customize the reminder body via **`missingLabelsMessage`** in the plugin
  options — placeholders `{available_labels}` (bullet list) and `{issue_key}`
  are substituted. Default template lives in
  [missing-labels-handler.ts](../packages/jira-adapter/src/handlers/missing-labels-handler.ts).
- The flow is stateless — there is no dedup cache. With the default behavior
  (`jira:issue_created` → `analyze`, `jira:issue_updated` → `analyze`) the
  reminder is posted at most once per ticket because we only comment on
  create; subsequent updates that still don't match stay silent.
- To get the old "comment on every update" behavior back, set
  `webhookBehavior.events."jira:issue_updated".action` to `"acknowledge"` in
  your config.

### Read-only analysis (default)

To prevent an investigating agent from modifying the target repository when a
Jira ticket is misinterpreted as a change request, the adapter emits every
`analyze` task with `metadata.readOnly = true`. The orchestrator forwards the
flag to the agent runner, and the **opencode** adapter turns it into a stricter
`OPENCODE_PERMISSION` env var that **denies** the `bash`, `edit`, `write`,
`multiedit`, and `patch` tools — see [opencode.ts](../src/agents/opencode.ts).

- Opt out per deployment with **`jira-adapter.analysisReadOnly: false`** in your
  config if you genuinely want the agent to be able to apply fixes from Jira.
- The default analysis prompt in
  [local-repos-plugin/types.ts](../packages/local-repos-plugin/src/types.ts)
  also instructs the agent to produce a written report only — this is the
  *soft* layer complementing the hard tool-permission layer.
- You can confirm it's active by looking at the startup log for an analysis
  task: **`Agent start task=KAN-N agent=opencode repo=/… readOnly=true`**.
- Read-only mode is opencode-specific today. If you route analysis through
  another agent (`claude`, `codex`, `gemini`), add equivalent flag handling in
  that agent's `buildCommand` before relying on this guarantee.

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
