# Linear adapter (Phase B baseline)

**Canonical execution plan** for the Linear integration initiative. Update this file as work completes (checkboxes, dates, decisions, PR links). When the initiative merges to `main`, move this file to [`../completed/`](../completed/) and add a short completion note per [exec-plans README](../README.md).

## Repository workflow

- **Branch:** At implementation kickoff, create a dedicated feature branch from `main` (suggested name: `feat/linear-adapter-phase-b`). Land work via PR(s) targeting that branch or `main` using stacked PRs if the change set is large.
- **Plan hygiene:** Treat **this document** as the living source of truth for scope and acceptance. After each meaningful milestone (spike done, package scaffolded, pr-pipeline refactor merged, docs pass), edit the **Acceptance criteria** and **Progress** sections below. Avoid letting only chat or the Cursor plan file carry state.

## Goal

Ship `@agent-detective/linear-adapter` with **Phase B** as the baseline: **OAuth**-installed Linear app, **signed webhooks**, **`@linear/sdk`** + GraphQL for enrichment and post-back—mirroring Jira **analyze** and **PR** flows after a **tracker abstraction** in `pr-pipeline`. Optional **Personal API key** remains a documented dev escape hatch only.

## Context (short)

- Jira reference: `packages/jira-adapter` — webhook → handlers → `RepoMatcher` → `TASK_CREATED` / `PR_WORKFLOW_SERVICE` → post-back on `TASK_COMPLETED`.
- Linear: [Integration Directory](https://linear.app/docs/integration-directory) expectations, [OAuth](https://developers.linear.app/docs/oauth/authentication), [SDK](https://developers.linear.app/docs/sdk); Phase C (native [Agents](https://developers.linear.app/developers/agents)) is out of scope for the first ship.

## Phase B — Detailed feasibility

**Verdict: yes.** Linear’s public API model fits a self-hosted service: OAuth for workspace authorization, webhooks for push ingress, GraphQL for enrichment and post-back. The work is **integration engineering** and **token lifecycle**, not a platform blocker.

### 1) OAuth 2.0 authorization (workspace install)

- **Flow:** Authorization code with **client id**, **client secret**, **redirect URI** in the Linear developer app ([OAuth](https://developers.linear.app/docs/oauth/authentication)). Exchange `code` for **access** + **refresh** tokens.
- **Self-hosted:** Redirect URI must be reachable by Linear (**HTTPS** + stable host, or documented tunnel for dev).
- **In-app:** Plugin-scoped routes (e.g. `GET .../oauth/start`, `GET .../oauth/callback`) with `state` (CSRF).
- **Directory:** Not required to *run* OAuth in your workspace; [Integration Directory](https://linear.app/docs/integration-directory) is a distribution step.

### 2) Token storage and refresh

- **Secrets:** Refresh (and optionally access) tokens via **env** / secret store—align with existing plugin env patterns (see `src/config/env-whitelist.ts` in the repo root); avoid committed `local.json` for secrets.
- **Refresh:** Implemented in-process: `oauthRefreshToken` + client id/secret → startup bootstrap if `apiKey` empty; proactive refresh when `expires_in` is known; reactive refresh on Linear `AuthenticationError` / auth GraphQL failures. **Persist** rotated refresh tokens when Linear returns a new `refresh_token` (env or secret store)—the adapter logs a warning but does not write config files.

### 3) Webhooks + signing

- Verify payloads with app **signing secret** (headers/algorithm per Linear webhook docs at implementation time).
- **Idempotency:** Log delivery/event ids; optional short TTL dedup for retries.

### 4) GraphQL + `@linear/sdk`

- Official [SDK](https://developers.linear.app/docs/sdk) for comments, issue fetch (labels, description, id), attachments if PR flow needs them.

### 5) Product mapping

- **RepoMatcher:** Linear issue **labels** (and team/project context) normalized like Jira labels.
- **Triggers:** Comment phrases (analyze / PR) + optional config filters (label/state).
- **Threading:** Map Linear comment threading to closest parity with Jira `parentId` during spike.

### 6) Risks and mitigations

| Risk | Mitigation |
|------|------------|
| HTTPS redirect in dev | Tunnel + docs; optional personal API key behind explicit dev-only flag |
| Token leakage | Never log refresh token; redact `Authorization` |
| Staging vs prod | Separate Linear OAuth apps / redirect URIs |
| `pr-pipeline` Jira-only | **Issue tracker port** abstraction (Jira + Linear impls) |

### 7) Not required for Phase B v1

- Public directory **submission**.
- Phase C [Agents](https://developers.linear.app/developers/agents) as the **primary** trigger.

## Acceptance criteria

- [x] Spike (partial): webhook **signature verification** + timestamp window; OAuth **authorize + callback** (code exchange); **refresh_token** grant at startup and on auth errors (in-memory rotation; operator persists new refresh when Linear rotates it).
- [x] Package `packages/linear-adapter`: plugin, Zod options, OAuth routes + signed `POST /webhook/linear`, **`routeLinearWebhook`** (`linear:Issue:create` / `linear:Comment:create` → RepoMatcher → `TASK_CREATED` / `PR_WORKFLOW_SERVICE`), **`TASK_COMPLETED`** → `createComment`, `createLinearGraph` (mock vs real comments + issue fetch).
- [x] `pr-pipeline` uses **`issueTracker`** / **`PrIssueTrackerClient`**; Jira adapter passes the port; `PrJiraClient` kept as deprecated alias.
- [x] Config: `pnpm-workspace.yaml` catalog `@linear/sdk`, `config/default.json` disabled plugin entry, `AGENTS.md` / `README.md`, `env-whitelist` for `LINEAR_*`, `docs:plugins` regenerated.
- [x] Tests: unit tests for signing + options schema; routing/OAuth exchange E2E **not** added yet; manual smoke **not** run.
- [ ] Docs: full operator/plugin prose under `docs/plugins` for Linear (optional follow-up).
- [x] Landing: `apps/landing` strings mention Linear alongside Jira.

## Progress log

| Date | Note |
|------|------|
| 2026-04-27 | Branch `feat/linear-adapter-phase-b`: tracker port in types + `pr-pipeline`; new `@agent-detective/linear-adapter` (webhook verify, stub handler, env + docs artifacts); `pr-pipeline` `dependsOn` trimmed to `local-repos-plugin` only. |
| 2026-04-27 | Linear adapter: webhook routing + analyze/PR fan-out + `TASK_COMPLETED` post-back; `webhookBehavior` + triggers aligned with Jira; `apiKey` required when plugin enabled. |
| 2026-04-27 | OAuth routes + PR fan-out parity (comments/attachments); **`oauthRefreshToken`** + refresh grant (`exchangeLinearRefreshToken`), PAT vs OAuth `LinearClient` (`apiKey` vs `accessToken`), proactive/reactive refresh in `createLinearGraph`; env `LINEAR_OAUTH_REFRESH_TOKEN`. |

## Out of scope (v1)

- Linear Integration Directory **submission** process.
- Phase C: Linear Agents API as the **primary** trigger (optional follow-on).
