# Manual E2E: Jira webhook → local server → repo context → comment

This guide walks through testing the full path locally, including how Jira Cloud reaches your machine, what to configure, and how to verify each step.

## Prerequisites (local machine)

1. **Node 24+** and **pnpm** — see [development.md](../development/development.md).
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

4. Subscribe at least to **Issue: created** and **Comment: created** — the latter powers the manual retry flow (see ["Matching a ticket to a repository"](#matching-a-ticket-to-a-repository)). **Issue: updated** is no longer needed; the adapter ignores it by default.

No path prefix beyond `/plugins/...` is required unless you put a reverse proxy in front.

### Which webhook source are you using?

Jira Cloud offers two ways to send HTTP requests when issues change. Both are supported; the only difference is **how the event name reaches us**. The adapter accepts all three signals listed in [`resolveWebhookEvent`](../../packages/jira-adapter/src/presentation/jira-webhook-controller.ts) and normalizes them to the canonical `jira:*` form before routing.

| Source | Where Jira is configured | How the event arrives | What you do |
|---|---|---|---|
| **Native webhook** | Settings → System → WebHooks (site admin) | `body.webhookEvent = "jira:issue_created"` | Just point it at the base URL. Nothing else. |
| **Automation — "Automation format"** | Automation rule → Send web request → *Web request body: Automation format* | `body.issue_event_type_name = "issue_created"` (or `"issue_generic"` for most updates). **Body is the issue object directly at the top level**, not wrapped in `{ issue: … }`. | Append `?webhookEvent=jira:issue_created` to the URL (event name). The adapter auto-detects and wraps the bare-issue body — no template edits needed. |
| **Automation — "Jira format"** | Automation rule → Send web request → *Web request body: Jira format* | Body is `{ issue, user, timestamp }`; no event in body. | **Append `?webhookEvent=jira:issue_created` (or the matching value) to the URL**, one rule per event. |

Notes:

- **Automation-format bodies omit the envelope.** Jira Automation's "Automation format" default body expands `{{issue}}` at the top level, so the request looks like `{ self, id, key, fields, changelog, renderedFields }`. The adapter detects this via `key` + `fields` at the top level and auto-wraps it as `{ issue: { …bareIssue } }` before validation — see [`normalizeWebhookShape`](../../packages/jira-adapter/src/application/webhook-handler.ts). You'll see `"shape":"bare-issue"` in the `Webhook payload accepted` log line when this triggers.
- **Automation format still doesn't include the event name by default.** The body contains the issue, but not the trigger. Prefer `?webhookEvent=…` on the URL or customize the action's "Custom data" to add `{"issue_event_type_name":"{{issueEventTypeName}}"}` — both are more explicit than relying on shape inference.
- **Payload-shape fallback.** When none of the explicit sources above provide an event, the adapter inspects the payload itself: a `comment` object ⇒ `jira:comment_created`, a non-empty `changelog.items` array ⇒ `jira:issue_updated`, otherwise (issue envelope or bare-issue) ⇒ `jira:issue_created`. The `comment` case wins over `changelog` because comment-event Automation rules typically include both. You'll see `Resolved webhook event from payload.shape: jira:comment_created` in the logs when this kicks in. This is a safety net for Automation rules that forget the URL query — routing still works, but the log makes it obvious you should fix the rule for clarity.
- If the payload doesn't look like an issue event at all, the adapter resolves to `unknown` and falls back to `webhookBehavior.defaults`. Use the `Webhook payload accepted` summary line to diagnose.
- When the event comes from anywhere other than `body.webhookEvent`, you'll see a single `Resolved webhook event from <source>: jira:issue_created (raw="issue_created")` log line that tells you where we picked it up and what we normalized it to.
- Your `webhookBehavior.events` config stays in canonical form (`jira:issue_created`, `jira:issue_updated`, …) regardless of source — see [default.json](../../config/default.json).

## Configuration

Use **`config/local.json`** (merged over `default.json`, typically gitignored) so secrets stay off git. Copy from [config/local.example.json](../../config/local.example.json).

### Local repos plugin

- Set **`repos`** with an absolute **`path`** and a short stable **`name`** (e.g. `my-test-repo`).
- In Jira, add an issue **label** identical to that **`name`** — this is the only way the adapter links a ticket to a repo (see "Matching a ticket to a repository" below). Labels are matched case-insensitively against `repos[].name`.
- The plugin exposes a **`RepoMatcher`** service (`REPO_MATCHER_SERVICE` from `@agent-detective/types`) that the Jira adapter calls before dispatching any analysis. It returns the first configured repo whose `name` matches any of the issue's labels, or `null`.

### Jira adapter

- **Webhook URL (fixed):** Jira Automation / webhooks must target **`/plugins/agent-detective-jira-adapter/webhook/jira`** (plugin route prefix + controller path). This is not configurable in options.
- **`webhookBehavior`:** default maps **`jira:issue_created`** → **`analyze`** ([default.json](../../config/default.json)).
- **`mockMode: true`:** analysis runs; “comments” are logged as **`[MOCK] Added comment...`** ([mock-jira-client.ts](../../packages/jira-adapter/src/infrastructure/mock-jira-client.ts)).
- **`mockMode: false`:** posts real comments via **Jira REST API v3** using the [`jira.js`](https://www.npmjs.com/package/jira.js) SDK (`Version3Client`) — see [real-jira-client.ts](../../packages/jira-adapter/src/infrastructure/real-jira-client.ts). You must set **`baseUrl`**, **`email`**, and **`apiToken`** (or **`JIRA_BASE_URL`**, **`JIRA_EMAIL`**, **`JIRA_API_TOKEN`** in the environment — see [env-whitelist.ts](../../src/config/env-whitelist.ts)).
- **Comment formatting (Markdown → ADF):** the agent is prompted to return GitHub-flavored Markdown and the adapter converts it to [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) before posting — see [markdown-to-adf.ts](../../packages/jira-adapter/src/infrastructure/markdown-to-adf.ts). Supported elements: headings, **bold**, *italic*, ~~strike~~, `inline code`, fenced code blocks with language, bullet / ordered / nested lists, blockquotes, links, horizontal rules, and hard breaks. HTML and tables are not supported and are rendered as plain text.

Optional: override **`analysisPrompt`** on `jira:issue_created` to steer the model toward root-cause analysis.

### Matching a ticket to a repository

The adapter uses **labels only** — no AI-driven guessing, no fallbacks — to
decide which repo a ticket belongs to. There are exactly two triggers for a
match attempt:

1. **`jira:issue_created`** — the one-shot path for tickets created with the
   right labels already set.
2. **`jira:comment_created`** with a trigger phrase — the explicit retry path
   for everything else. This replaces the previous `jira:issue_updated`
   changelog-based retry, so silent edits, status transitions, assignee
   changes and label curation never re-trigger analysis.

The rules:

- **On `jira:issue_created`**, the adapter looks at `issue.fields.labels` and
  asks the `RepoMatcher` service for case-insensitive matches against every
  configured repo name.
  - **One or more matches →** the adapter emits a `TASK_CREATED` event **per
    matched repo**, with `context.repoPath` / `context.cwd` pre-set to that
    repo and `metadata.matchedRepo` set to its name. See "Multiple repos per
    issue" below.
  - **No match →** the adapter posts a single Markdown comment asking the
    reporter to add a label **and** leave a follow-up comment containing the
    **retry trigger phrase**. No task is created; the ticket stays quiet
    until the user explicitly asks for another attempt.
- **On `jira:comment_created`**, the adapter runs the match again **only
  when** the comment body contains the configured trigger phrase
  (case-insensitive substring) **and** the comment was not authored by the
  adapter itself.
  - **Trigger + one or more matches →** the same fan-out as
    `issue_created`. Result comments are posted with a `## Analysis for
    <repo>` heading and a fan-out acknowledgment for multi-repo cases.
  - **Trigger + still no matching label →** the adapter posts the reminder
    again (the user asked). This is intentionally stateless: if the labels
    are wrong, re-running `<trigger>` will just ask again, which is the
    right escalation path.
  - **No trigger phrase, or adapter-authored comment →** silent. No task,
    no comment.
- **On everything else** (`jira:issue_updated`, `jira:issue_deleted`, …),
  the adapter does nothing unless you explicitly override the action in
  `webhookBehavior.events`. Defaults ignore these events to prevent comment
  spam on unrelated field edits.
- Customize the reminder body via **`missingLabelsMessage`** in the plugin
  options — placeholders `{available_labels}` (bullet list), `{issue_key}`,
  and `{trigger_phrase}` are substituted. Default template lives in
  [missing-labels-handler.ts](../../packages/jira-adapter/src/application/handlers/missing-labels-handler.ts).
- Customize the trigger phrase via **`retryTriggerPhrase`** (default
  `#agent-detective analyze`). The phrase is matched as a case-insensitive
  substring so it can be embedded in longer sentences like
  *"labels added — #agent-detective analyze please"*. Pick a phrase that
  is extremely unlikely to show up in normal conversation on the ticket,
  because any user comment containing it will kick off analysis.

#### Loop protection (four layers)

Two kinds of webhook-echo loop are possible: the **reminder loop** (the
adapter's missing-labels comment triggers another comment_created that
matches the trigger phrase and posts the reminder again) and the
**analysis loop** (the adapter's result comment is mis-identified as a
fresh `issue_created` by Jira Automation "Automation format" rules,
which runs the agent again, which posts another comment…). Four
independent layers guard against both:

1. **Correct event classification.** When the webhook carries no
   explicit event name (the common case for Jira Automation rules that
   forget the URL override), the adapter infers it from the payload
   shape. Any `changelog` signal —
   top-level `items`, `histories` from `{{issue}}.changelog`, or a
   non-zero `total` — classifies the event as `jira:issue_updated`,
   which defaults to `ignore`. Only genuine creations (no changelog
   activity, empty history page) are routed to `analyze`. Every
   inference is logged as
   `Resolved webhook event from payload.shape: jira:<event> — <reason>`
   so you can audit why a specific webhook was or was not analyzed.
2. **Visible footer marker.** Every comment the adapter posts ends with
   a *"— Posted by agent-detective · ad-v1"* footer (rendered from a
   Markdown `---` + italic line). The `comment_created` handler ignores
   any comment containing the `agent-detective · ad-v1` token, so the
   adapter's own acknowledgments, reminders, result posts and fan-out
   summaries never re-trigger analysis even when they quote the trigger
   phrase. The footer lives in ordinary ADF text nodes, so it survives
   Jira's Markdown → ADF serialization and the webhook echo round-trip
   reliably. (An earlier hidden-HTML-comment marker was dropped in some
   Jira pipelines, which is exactly how the loop originally showed up.)
3. **Optional `jiraUser` identity.** Configure
   **`jiraUser.accountId`** or **`jiraUser.email`** with the Jira
   account the adapter posts as. Comments from that account are then
   ignored regardless of footer presence. Optional; useful if an
   operator customizes the reminder template and strips the footer.
4. **Circuit breakers.** As a last line of defense the adapter refuses
   to repeat certain actions for the same issue within a short window:
   - **Missing-labels reminders:** at most one per issue per 60 s. Logs
     `suppressing duplicate missing-labels reminder for <KEY>`.
   - **Auto-analysis of the same `(issue, repo)` pair:** at most one
     per 10 min, for non-comment-triggered events only (classic
     `issue_created` and any custom `issue_updated → analyze` mapping).
     Explicit `jira:comment_created` retries bypass this window because
     a human explicitly asked for a fresh run. Logs
     `suppressing auto-analysis of <KEY>:<repo> (ran Ns ago, …)`.

If either circuit-breaker warning shows up in steady-state traffic it
means one of the upstream guards (1–3) is misbehaving and should be
investigated — the breakers keep things safe but they are diagnostics
of a real misconfiguration, not a design endpoint.

Comments stamped with the legacy `<!-- agent-detective:v1 -->` marker
(anything posted before the footer change) are still recognized as
adapter-authored so historical tickets don't suddenly flap.

### Multiple repos per issue (fan-out)

A single Jira ticket can legitimately touch more than one repository
(cross-service bug, backend + frontend change, etc.). When its labels match
several configured repos at once, the adapter **fans out**:

- **One analysis per matched repo.** Each repo gets its own agent run with
  `context.repoPath` / `context.cwd` scoped to that repo. Tasks use distinct
  queue keys of the form `<ISSUE-KEY>:<repo-name>` (e.g. `KAN-42:api`,
  `KAN-42:frontend`) so the orchestrator queue doesn't collapse them.
- **opencode runs are serialized.** opencode stores per-user state in a
  single SQLite DB under `~/.local/share/opencode/` and crashes when two
  instances race to open it (upstream
  [anomalyco/opencode#21215](https://github.com/anomalyco/opencode/issues/21215)).
  To avoid `Failed to run the query 'PRAGMA journal_mode = WAL'` crashes,
  the agent-runner marks opencode as `singleInstance: true` and releases
  one opencode invocation at a time globally. The fan-out still works —
  you'll see one analysis comment per repo — but they run back-to-back
  rather than in parallel. Look for
  `Agent queued task=KAN-42:frontend agent=opencode singleInstance=true waitMs=…`
  in the logs when this serialization kicks in.
- **One Jira comment per repo.** Result comments are prefixed with
  `## Analysis for \`<repo-name>\`` so readers can tell them apart on the
  ticket.
- **One acknowledgment.** When a fan-out actually fans out (2+ repos or any
  cap-skipped repos), the adapter posts a single summary comment up-front —
  e.g. *"Analyzing this issue across 2 repositories: `api`, `web-app`. Results
  will be posted as separate comments below."* Single-repo matches skip the
  ack to stay quiet.
- **Safety cap via `maxReposPerIssue`** (default `5`). If an issue matches
  more than `maxReposPerIssue` repos, the adapter analyzes the first N (in
  configured-repo order), names the ones it skipped in the ack, and logs a
  warning. Set it to `0` to disable the cap.

### Manual retry via comment

Because retries are always user-initiated, the adapter does not need any
dedup bookkeeping — it simply re-matches the issue's current labels on
every `comment_created` event that contains the trigger phrase. Expected
behaviors:

- Ticket created with no matching label → adapter posts the reminder.
  User adds the label, leaves `#agent-detective analyze` (or your configured
  phrase) → adapter runs analysis. No `issue_updated` wiring required.
- Already-analyzed ticket, user comments `#agent-detective analyze` again
  → adapter runs analysis again, fresh, against the current labels. This
  is explicit: if you don't want a re-run, don't post the phrase.
- User adds/removes labels without commenting with the trigger → silent.
  Editing labels is harmless and no longer spams the ticket.
- User comments the trigger phrase with **no** matching label → the
  reminder is posted again. The user asked; the adapter answers.
- Adapter's own result/reminder comments contain the trigger phrase (e.g.
  quoted in the reminder text) → silent, thanks to the visible footer
  marker; the 60s reminder rate-limit is the last-ditch backstop if the
  footer is ever stripped.

### Read-only analysis (default)

To prevent an investigating agent from modifying the target repository when a
Jira ticket is misinterpreted as a change request, the adapter emits every
`analyze` task with `metadata.readOnly = true`. The orchestrator forwards the
flag to the agent runner, and the **opencode** adapter turns it into a stricter
`OPENCODE_PERMISSION` env var that **denies** the `bash`, `edit`, `write`,
`multiedit`, and `patch` tools — see [opencode.ts](../../src/agents/opencode.ts).

- Opt out per deployment with **`jira-adapter.analysisReadOnly: false`** in your
  config if you genuinely want the agent to be able to apply fixes from Jira.
- The default analysis prompt in
  [local-repos-plugin/types.ts](../../packages/local-repos-plugin/src/domain/types.ts)
  also instructs the agent to produce a written report only — this is the
  *soft* layer complementing the hard tool-permission layer.
- You can confirm it's active by looking at the startup log for an analysis
  task: **`Agent start task=KAN-N agent=opencode repo=/… readOnly=true`**.
- **opencode** and **cursor** map `readOnly` into their CLIs (opencode: `OPENCODE_PERMISSION` deny-list; cursor: `--mode=ask`). **claude** does not map `readOnly` in its adapter; do not treat analysis as tool-safe if you switch the default agent to `claude` without additional hardening.

## Smoke test without Jira Cloud

With the server running (`pnpm dev`):

```bash
pnpm run jira:webhook-smoke
```

This POSTs [issue-created.json](../../packages/jira-adapter/test/fixtures/issue-created.json) to the webhook. Expect **`{"status":"queued","taskId":...}`** and log lines for orchestration plus **`[MOCK]`** when `mockMode` is true.

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

- [configuration.md](../config/configuration.md) — config merge and env whitelist  
- [jira-pr-pipeline-manual-e2e.md](jira-pr-pipeline-manual-e2e.md) — manual test of Jira comment → PR pipeline (worktree, push, GitHub/Bitbucket)  
- [docker.md](../operator/docker.md) — running in containers  
- [development.md](../development/development.md) — local dev and `mockMode` overview  
