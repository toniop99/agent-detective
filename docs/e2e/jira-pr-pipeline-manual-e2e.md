---
title: "Manual E2E: Jira comment → PR pipeline"
description: End-to-end test of Jira comment triggering PR creation via worktree and host API.
sidebar:
  order: 3
---

# Manual E2E: Jira comment → PR pipeline (worktree, agent, host PR)

This guide walks through testing **Jira-triggered pull request creation** end to end: a **comment** on a ticket (default trigger `#agent-detective pr`) is matched to a local clone via **labels**, the **pr-pipeline** plugin runs a **write-mode** agent in a **git worktree**, then either **dry-runs** or **pushes and opens a PR** on **GitHub** or **Bitbucket Cloud**. It complements the read-only analysis walkthrough in [jira-manual-e2e.md](jira-manual-e2e.md).

## How this differs from “analyze”

| | **Analyze** (`#agent-detective analyze` by default) | **PR pipeline** (`#agent-detective pr` by default) |
|---|--------------------------------------|----------------------------------|
| **Jira event** | `jira:issue_created` and/or `jira:comment_created` (when the **retry** phrase matches) | **`jira:comment_created` only** when the **PR** phrase matches (and PR wins if both appear in the same comment) |
| **Service** | Core queue + `TASK_CREATED` | **`PR_WORKFLOW_SERVICE`** from `@agent-detective/pr-pipeline` (must be listed in `plugins`) |
| **Agent mode** | Read-only by default (`metadata.readOnly = true`) | **Write** (edits in a temporary worktree) |
| **Git** | Optional context only | **Worktree, commit, push**, host REST API to open a PR |
| **Config** | Jira + local-repos | Jira + local-repos + **pr-pipeline** + per-repo **`vcs`**, **tokens** |

If `@agent-detective/pr-pipeline` is not loaded, the Jira handler posts a short comment telling you to add the plugin; analysis behavior is unchanged.

## Prerequisites (local machine)

1. **Node 24+** and **pnpm** — [development.md](../development/development.md).
2. **OpenCode** (or the agent you configure for pr-pipeline) on your `PATH`, plus **LLM / provider** credentials.
3. A **bare-metal git clone** on disk (the **local-repos** `path`) whose **`origin` remote** points at the same GitHub or Bitbucket repository you will open PRs against. The pipeline runs `git fetch` / `git worktree` / `git push` against that remote; **`base` branch** must exist on the remote (see `prBaseBranch` below).
4. **Jira Cloud** with permission to add **webhooks** (or **Automation** rules) and, for real Jira comments, a **Jira API** app password or token (`mockMode: false`).

You already need everything from [Jira → localhost](jira-manual-e2e.md#how-jira-reaches-localhost) if you use Jira Cloud: a **public HTTPS URL** (tunnel) to your local `PORT` (default `3001`).

**Webhook path** (unchanged):

`https://<tunnel-host>/plugins/agent-detective-jira-adapter/webhook/jira`

**Events:** subscribe to **Comment: created** (required for the PR flow) and, if you also want analyze on create, **Issue: created** — same as the main e2e doc.

## Configuration checklist

Work from `config/local.json` (see [config/local.example.json](../../config/local.example.json) and [configuration.md](../config/configuration.md)).

### 1. Plugins: order and presence

1. `@agent-detective/local-repos-plugin`
2. `@agent-detective/jira-adapter`
3. `@agent-detective/pr-pipeline` (after the two above; the plugin’s `dependsOn` enforces this in code)

`pr-pipeline` is **not** optional for real PRs: without it, Jira will only show the “install pr-pipeline” message.

### 2. Local repos: `repos[]` and labels

- Same as the analysis guide: each repo has a **`name`**; the Jira issue must carry a **label** equal to that `name` (case-insensitive).
- **`path`**: absolute path to a **normal** `git` working tree.
- For PR creation you must add **`vcs`**, **and** align **`prBaseBranch`** (default in code: `main`) with a branch that exists on **`origin`**.

**GitHub example** (in `options.repos[]` for local-repos):

```json
{
  "name": "my-test-repo",
  "path": "/abs/path/to/clone",
  "prBaseBranch": "main",
  "prBranchPrefix": "hotfix/",
  "vcs": { "provider": "github", "owner": "my-org", "name": "my-repo" }
}
```

**Bitbucket Cloud example:**

```json
"vcs": { "provider": "bitbucket", "owner": "<workspace>", "name": "<repo-slug>" }
```

`owner` / `name` are the same segments you see in the browser URL for the repository.

### 3. Jira adapter: `jira:comment_created` and triggers

- Under **`webhookBehavior.events`**, set **`jira:comment_created`** to **`{ "action": "analyze" }`**. You only need this **one** mapping for comment events: the value `"analyze"` is the **Jira plugin router** — it means “call `handleAnalyze` for this webhook event.” It does *not* mean “read-only analysis only.”
- For **`jira:comment_created`**, `handleAnalyze` then inspects the **comment text** (unless the comment is from the bot — loop protection):
  1. If **`prTriggerPhrase`** is present (default `#agent-detective pr`) → **PR pipeline** (write worktree, optional push/PR), when labels match and pr-pipeline is loaded.
  2. Else if **`retryTriggerPhrase`** is present (default `#agent-detective analyze`) → **read-only analysis** (TASK_CREATED fan-out), when labels match.
  3. If **both** phrases appear in the same comment, **PR wins** (PR is checked first).
  4. If **neither** phrase appears → no workflow; the comment is ignored for automation.
- **`prTriggerPhrase`** (default `#agent-detective pr`) — case-insensitive substring; text **before/after** the first occurrence of this phrase (with the phrase removed) becomes **`prCommentContext`** for the agent (see the PR pipeline section in [configuration.md](../config/configuration.md) — “Extra context in the same comment”).
- **`retryTriggerPhrase`** (default `#agent-detective analyze`) — case-insensitive substring for analysis retries. **`jira:issue_created`** with `"action": "analyze"` is unrelated to these phrases: new issues always go through **label match → analysis** only (no comment trigger).

### 4. pr-pipeline plugin

- **`prDryRun: true`** (default in [default.json](../../config/default.json)) — **no** `git push`, **no** host API PR; a Jira comment describes what **would** happen. Use this first.
- **`prBranchPrefix`**, **`prTitleTemplate`** — see [plugin-options.md](../reference/generated/plugin-options.md) (pr-pipeline block).
- **`worktreeSetupCommands`** — array of shell commands run in the worktree (cwd = worktree root) after checkout and before the agent. Use them to install dependencies, copy gitignored files, or run any repo-specific setup. The token `{{mainPath}}` is replaced with the absolute path of the source repo. Each command is run via `sh -c`; failures are logged as warnings and do not abort the workflow. Example:
  ```json
  “worktreeSetupCommands”: [
    “composer install --no-dev”,
    “cp {{mainPath}}/docker/.env docker/.env”
  ]
  ```
- **Secrets** (env overrides file; see “Host credentials precedence” in [configuration.md](../config/configuration.md))  
  - **GitHub:** `GITHUB_TOKEN` or `GH_TOKEN`, or `githubToken` in config.  
  - **Bitbucket (recommended — new API token):** `BITBUCKET_USERNAME` (your Bitbucket username, not email) + `BITBUCKET_EMAIL` (your email, for REST API) + `BITBUCKET_APP_PASSWORD` (the API token value from *Personal settings → API tokens*). Required scopes: `read:repository:bitbucket`, `write:repository:bitbucket`, `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket`.  
  - **Bitbucket (legacy — workspace/repo access token):** `BITBUCKET_TOKEN` or `bitbucketToken`. Uses `x-token-auth` for Git; only for older token types.

Only when **`prDryRun`** is **false** and **credentials** + **`vcs`** are valid will the app push and call the host API. Wrong or missing `vcs` / tokens produce a **Jira comment** explaining what to set (not a generic 500 in most cases).

### 5. `mockMode` (Jira API)

- **`mockMode: true`:** pr-pipeline still runs (worktree, agent, commit). Jira “comments” from the PR job are **logged** as `[MOCK] Added comment...` and do not hit Jira. Use to validate git + agent without a Jira token.
- **`mockMode: false`:** you need Jira auth so the pipeline can post the dry-run or PR result back to the ticket:
  - **Basic:** `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, or
  - **OAuth 2.0 (3LO):** `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET`, `JIRA_OAUTH_REFRESH_TOKEN`, `JIRA_CLOUD_ID` (and optionally `JIRA_API_TOKEN` as the current access token).

## Step-by-step: dry run (recommended first)

1. Set **`prDryRun: true`** and ensure **`@agent-detective/pr-pipeline`** is in `plugins`.
2. Set **`vcs`** on the repo you will match (so the dry-run message names GitHub/Bitbucket correctly; optional for a minimal test but recommended).
3. Start the app: `pnpm dev` (or your production command) with a valid **`config/`** cwd.
4. Expose the server with a **tunnel**; confirm `GET` health or open the Jira webhook URL path only after the server is up.
5. In Jira, open an issue with:
   - A **label** equal to your **`repos[].name`**, and  
   - A description that is safe to use as the agent input (or minimal).
6. Add a **comment** such as:  
   `#agent-detective pr optional: file auth.php and stack trace from logs`  
   (Anything outside the first occurrence of the PR trigger phrase is passed as **additional context** to the agent.)
7. **Expected (mock Jira on):** server logs show pr-pipeline enqueue, git worktree, agent run, then `[MOCK]` Jira line with a **dry-run** summary (branch name, target repo, truncated agent output). If the agent made no edits, the message explains that instead.
8. **Expected (real Jira):** a new **Jira comment** on the issue with a **pr-pipeline (…, dry run)** message and no remote branch created.

If the issue has **no matching label**, you get the same **missing-labels reminder** as for analyze (and no PR work).

## Step-by-step: real push and PR (GitHub)

1. Set **`prDryRun: false`**.
2. Set **`GITHUB_TOKEN`** (or `GH_TOKEN`) in the environment with **repo** scope to push and open PRs on the target repository (fine-grained or classic per GitHub’s docs).
3. Ensure **`vcs.owner` / `vcs.name`** match that GitHub repository.
4. Ensure **`prBaseBranch`** (e.g. `main`) exists on **`origin`** in your local clone (`git fetch origin` and `git rev-parse origin/main` or your branch name).
5. Post a Jira comment with `#agent-detective pr` (and optional context as above).
6. **Expected:** after the agent makes changes, a **new branch** is pushed, a **PR** is created, and a Jira **comment** contains the **PR URL** (or an error message from git/API).

**Git LFS / protected branches / required reviews** are your hosting rules; the pipeline does not special-case them.

## Step-by-step: real push and PR (Bitbucket Cloud)

1. Set **`prDryRun: false`** and **`"vcs": { "provider": "bitbucket", ... }`** with correct **workspace** and **repo slug**.
2. Prefer **`BITBUCKET_TOKEN`** (repository or workspace access token) with **repository write** and **pull request** permissions, *or* **username + app password** — see [configuration.md](../config/configuration.md).
3. If Bitbucket requires a **bot email** for Git commits tied to the token, you may need to adjust **`git config user.email`** in automation; the pipeline sets a generic local name/email for the commit in the worktree (you can extend this later if your workspace enforces a policy).
4. Post the Jira **PR** comment as for GitHub.
5. **Expected:** push to `bitbucket.org`, PR via REST **Bearer** (token) or **Basic** (app password), Jira comment with the PR link.

## Multi-repo and caps

If several labels match multiple `repos[]` entries, the Jira handler **fans out** one PR job per repo (subject to **`maxReposPerIssue`** on the Jira plugin), similar to analysis fan-out. You will see a **“Starting **PR** workflow** …” Jira comment when more than one repo is involved or the cap skips repos.

## Optional: HTTP smoke without the Jira UI

The bundled [jira:webhook-smoke](../../package.json) script posts **`issue_created` only** — it does **not** exercise the PR path. To smoke **`comment_created`** you must POST a body that the adapter can normalize to **`jira:comment_created`** with a **`comment`** object. The handler tests in [packages/jira-adapter/test/handlers/index.test.ts](../../packages/jira-adapter/test/handlers/index.test.ts) show minimal shapes (e.g. `comment: { body, author: { accountId, emailAddress } }`). Point **`JIRA_WEBHOOK_URL`** at your tunnel. For a native webhook, include **`"webhookEvent": "jira:comment_created"`** at the top level and an **`issue`** plus **`comment`** as your Jira version expects.

## Troubleshooting (quick)

| Symptom | What to check |
|--------|----------------|
| “pr-pipeline is not loaded” | Add **`@agent-detective/pr-pipeline`** to `plugins` and restart. |
| “no source config for repo” | **`repos[].name`** must match a label; **`path`** must be configured for that name. |
| “set `vcs`” / token errors in Jira | **`vcs`**, **`prDryRun`**, and **host tokens** per [configuration.md](../config/configuration.md) (PR pipeline). |
| `Base ref origin/… not found` | **`prBaseBranch`** and **`git fetch`**: branch must exist on **origin**. |
| Agent makes no file changes | Jira comment shows “no file changes” and agent output; refine the **issue description** or **PR comment context**. |
| PR API 401/403 | Token scopes, repository access, or app password permissions. |

## Safety (git, remote, and agent)

This section describes what the [run-pr-workflow implementation](../../packages/pr-pipeline/src/application/run-pr-workflow.ts) is designed **not** to do, and where operational risk can still appear.

### What the pipeline does not do

- It does **not** use the GitHub or Bitbucket REST APIs to **delete a repository** or to **delete arbitrary remote branches** — the host integration **creates a pull request** only.
- It does **not** `git push --force` to your **base** branch (`main` / `prBaseBranch`). Pushes target only the **feature** ref built for the Jira run (e.g. `hotfix/PROJ-12`).
- It does **not** remove the main working copy at `repos[].path`. It only adds a **separate** worktree under a **temporary** directory (`mkdtemp` in the OS temp area).

### Local clone: branch and worktree behavior

- The pipeline runs **`git worktree add -B <branch> <tmp-path> origin/<prBase>`** in your configured clone. The **`-B`** flag creates the branch or **resets** it to the given base. If a **local** branch with the same name already existed for a different purpose, that ref can be **moved** — only in this clone, not on the host.
- After the run, **`git branch -D <branch>`** runs in the main clone to delete the **local** feature branch. It does **not** delete the branch on the remote. If you manually reused the **exact** branch name the pipeline would use (prefix + Jira key), a concurrent or repeated run could affect that name; in practice the name is derived from the issue key and your prefix, so accidental reuse is rare.
- The **main** worktree at `path` is not deleted; the temp worktree is **removed** with `git worktree remove` and a best-effort `rm` of the path.

### Remote: pushes and branch clutter

- Pushes go to **`refs/heads/<featureBranch>`** only (no force to default branch). The pipeline does **not** open PRs with “delete the repo” semantics.
- There is **no** automatic “delete remote feature branch” after merge. You may accumulate **remote feature branches** or see a **non-fast-forward** push if the same name was pushed before; that surfaces as a failed push, not a silent wipe of the repository.

### Concurrency and tokens

- Two Jira PR jobs for the **same issue and repo** can contend on the **same local branch name** and worktree behavior if they overlap in time. Prefer relying on a **single** explicit comment per run, or ensure your deployment **serializes** pr-pipeline work if you re-trigger aggressively.
- **Tokens** in the environment and in `git` remote URLs are sensitive: protect **CI logs**, process listings, and backups. Use **least-scoped** tokens and short lifetimes when possible. See [Security notes](#security-notes) below for webhooks and verification gaps.

### Agent write access

- The **write-mode agent** can modify files in the **temporary worktree** before `git commit`. That is a separate class of risk from “Git deleted the repo”: review the **open PR** on the host and enforce branch protection / required reviews in GitHub/Bitbucket as you would for any automation.

## Security notes

- **Webhook URL:** treat tunnel URLs as secrets; rotate if leaked.
- **Host tokens** (`GITHUB_TOKEN`, `BITBUCKET_*`, app passwords) grant push and often full repo access. Prefer **CI secrets** and short-lived tokens where possible.
- **Incoming Jira webhooks** are not cryptographically verified in this codebase; use private tunnels and least privilege — same as [jira-manual-e2e.md](jira-manual-e2e.md#security-notes).

## Related docs

- [jira-manual-e2e.md](jira-manual-e2e.md) — tunnels, labels, analyze flow, `mockMode`  
- [configuration.md](../config/configuration.md) — env whitelist, PR pipeline, tokens, `vcs`  
- [plugin-options.md](../reference/generated/plugin-options.md) — generated Jira and pr-pipeline options  
