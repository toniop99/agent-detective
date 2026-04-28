---
title: "Linear adapter"
description: Configure the Linear adapter for webhooks, OAuth, label matching, and PR fan-out.
sidebar:
  order: 4
  badge:
    text: New
    variant: tip
---

# Linear adapter (`@agent-detective/linear-adapter`)

Bundled plugin that receives **Linear webhooks**, matches issues to local repos via **labels** (same idea as the Jira adapter), and fans out **code analysis** tasks or the **PR pipeline** when `@agent-detective/pr-pipeline` is installed.

## How webhooks, OAuth, and trigger phrases fit together

People often mix these up because all three appear in setup at once. They solve **different** problems:

| Piece | Direction | Role |
|-------|------------|------|
| **Workspace webhook** (Linear → you) | Linear **POSTs** to your server | Delivers issue/comment events. Uses **`webhookSigningSecret`** / `Linear-Signature`, **not** the OAuth access token. You still register this URL in Linear even if you use OAuth for API calls. |
| **OAuth** (you → Linear) | Your server **calls** Linear’s GraphQL API | Authenticates **comment/issue reads and writes** (and refresh). Replaces a long-lived **personal API key (PAT)** for production-style installs. |
| **`#agent-detective analyze` / `pr`** (or your phrases) | Inside your app | After a **Comment** webhook arrives, the adapter **parses the comment body** and decides analyze vs PR. OAuth does **not** add `@mentions` or remove the need for trigger text—that would be a separate product change. |

So: **webhooks** bring work in; **OAuth (or PAT)** lets the server act on Linear; **trigger phrases** decide what to do with a comment event.

## Requirements

- **`local-repos-plugin`** must be enabled and configured with `repos[]` whose **`name`** values match Linear issue **labels** (case-insensitive).
- **`@agent-detective/pr-pipeline`** is optional; without it, PR trigger comments still run label matching but receive a Linear comment explaining that the PR workflow is not loaded.

## Enable the plugin

In `config/default.json` or `config/local.json`, add a `plugins` entry:

```json
{
  "plugins": [
    {
      "package": "@agent-detective/linear-adapter",
      "options": {
        "enabled": true,
        "mockMode": true,
        "apiKey": "lin_api_…"
      }
    }
  ]
}
```

Set **`enabled`: true** and provide credentials (see below). With **`mockMode`: true**, comment writes are logged instead of sent to Linear; reads (issue/labels, etc.) still use the API where the graph does not short-circuit them.

---

## Personal API key (PAT) — simplest path

1. Linear → **Settings** → **API** → **Personal API keys** → create a key.
2. Set **`apiKey`** or **`LINEAR_API_KEY`**. No OAuth fields required.
3. Comments and mutations are attributed to **that Linear user** (your avatar and name).

Good for local dev. For teams, OAuth is usually preferable (no human PAT on the server).

---

## OAuth application in Linear (developer console)

Create an app under Linear’s OAuth / API applications UI (exact navigation can change; look for **OAuth2** or **Applications**).

### Fields you will see (typical “Create application” form)

| Field | What to put |
|-------|----------------|
| **Application name** | Any user-visible name (e.g. `Agent Detective`). |
| **Developer name / URL / description** | Informational; not used for auth mechanics. |
| **Application icon** | Shown for the app in Linear; use at least **256×256** if Linear asks. |
| **Callback URLs** | **Required.** One full URL per line. Must match exactly what this host uses: **`{oauthRedirectBaseUrl}/plugins/agent-detective-linear-adapter/oauth/callback`** where `oauthRedirectBaseUrl` is **only the origin** (e.g. `https://abc.ngrok-free.app`, **no** trailing slash). For prod + tunnel, register **both** callback URLs. |
| **GitHub username** | Optional; used when Linear ties GitHub activity to `actor=app`. Not a substitute for `actor=app` or for trigger phrases. |
| **Public** | Leave **off** unless you want other workspaces to install the app from a directory-style flow. |
| **Client credentials** | Leave **off** unless you explicitly need the `client_credentials` grant; this adapter uses **authorization code + refresh token** by default. |
| **Webhooks (on the OAuth app)** | This toggle is for **app-level** webhooks in Linear’s UI. Your adapter still uses **workspace webhooks** you configure separately, pointing at **`POST …/webhook/linear`**. You can leave app webhooks off and still use workspace webhooks. |

After **Create**, copy **Client ID** and **Client secret** into **`oauthClientId`** / **`oauthClientSecret`** (or **`LINEAR_OAUTH_CLIENT_ID`** / **`LINEAR_OAUTH_CLIENT_SECRET`** — see [plugin env whitelist](../config/configuration.md#plugin-env-whitelist-first-party)).

---

## OAuth install flow (end-to-end)

These steps assume **`enabled`: true** and **`oauthRedirectBaseUrl`** set to the **same public origin** users and Linear will hit (ngrok, prod hostname, etc.).

### 1. Register OAuth routes (no access token yet)

Set **`oauthClientId`**, **`oauthClientSecret`**, **`oauthRedirectBaseUrl`**. The plugin mounts **`GET /plugins/agent-detective-linear-adapter/oauth/start`** and **`GET …/oauth/callback`** as soon as those three are present—you do **not** need a PAT or refresh token only to **open** the install URL (so the first install is not blocked).

### 2. Start the browser install

Open:

`https://<your-public-host>/plugins/agent-detective-linear-adapter/oauth/start`

You are redirected to Linear, approve the app, then land on **`/oauth/callback?code=…&state=…`**. The response is **JSON** (`Cache-Control: no-store`) with **`access_token`**, often **`refresh_token`**, and sometimes **`expires_in`**.

### 3. Tokens are **not** saved automatically

The server **does not** write `local.json` or environment variables for you. **You** copy:

| From callback JSON | Into config / env |
|--------------------|------------------|
| `access_token` | **`apiKey`** or **`LINEAR_API_KEY`** |
| `refresh_token` (if present) | **`oauthRefreshToken`** or **`LINEAR_OAUTH_REFRESH_TOKEN`** |

Keep client id, secret, and `oauthRedirectBaseUrl` as they are. **Restart** the process so it reloads config.

If Linear **rotates** the refresh token later, logs warn you—**update** the stored refresh token yourself; nothing auto-persists.

### 4. Omitting `apiKey` on purpose

- **Before** you have a refresh token in config: you still need **some** way to call the API after install—either paste **`access_token`** into `apiKey` / `LINEAR_API_KEY`, or paste **`refresh_token`** and use **`oauthClientId` + `oauthClientSecret` + `oauthRefreshToken`** with **empty** `apiKey` so the adapter runs one **refresh_token** grant at **startup** to obtain the first access token.
- **After** refresh is configured: you can run **refresh-only** (no `apiKey`) if you prefer.

### 5. Workspace webhook (unchanged)

Still configure Linear to **POST** to:

`https://<your-public-host>/plugins/agent-detective-linear-adapter/webhook/linear`

with **`webhookSigningSecret`** (unless you use **`skipWebhookSignatureVerification`** in dev only).

---

## Credentials summary (PAT vs OAuth)

| Mode | Config / env | `LinearClient` |
|------|----------------|----------------|
| **PAT** | `apiKey` or **`LINEAR_API_KEY`** | `apiKey` |
| **OAuth** | `apiKey` / **`LINEAR_API_KEY`** = access token, plus **`oauthClientId`**, **`oauthClientSecret`**, **`oauthRefreshToken`** (or env) | `accessToken` + refresh on expiry / auth errors |

---

## Comment attribution (app vs user)

**Default OAuth** uses Linear’s **`actor=user`**: the access token acts as **the user who clicked Authorize**—comments look like **your** user (same symptom as a PAT).

To post as the **application** (app branding from the Linear developer app):

1. Set **`oauthActor`** to **`"app"`** (or **`LINEAR_OAUTH_ACTOR=app`**).
2. Run **`/oauth/start` again** and complete consent so Linear issues a token bound to **`actor=app`** ([OAuth actor authorization](https://linear.app/developers/oauth-actor-authorization)).
3. Optional: **`oauthAppCommentDisplayName`** / **`oauthAppCommentDisplayIconUrl`** for Linear’s “User (via Application)” label + **public HTTPS** avatar URL (`createAsUser` / `displayIconUrl` on `commentCreate`). If you only set an icon, the adapter supplies a default display name so the API stays valid.

If you set **`oauthActor`: `"app"`** but still authenticate with a **PAT**, comments **stay** as you—the server logs a warning until you use **OAuth** tokens from the install flow, not a PAT.

---

## FAQ (common questions)

### I use OAuth—why do I still configure a webhook and still type `#agent-detective …`?

- **Webhook:** Linear must **push** events to your server; OAuth does not replace that.
- **Trigger phrases:** They are how this adapter **interprets** a comment after it arrives. OAuth does not add `@MyApp`-style invocations; that would require different detection logic or Linear’s Agents product (out of scope for this adapter’s v1 design).

### Can I get `@myapp` instead of hashtags?

Not from OAuth alone. You could extend the adapter to treat `@SomeName` in the comment body as a trigger if Linear includes it in the webhook payload—that is custom work, not enabled by the OAuth app record.

### How does the refresh token “get into” config—is it automatic?

**No.** Only the **browser JSON** from `/oauth/callback` contains the refresh token. You copy it into **`oauthRefreshToken`** / **`LINEAR_OAUTH_REFRESH_TOKEN`** (or `local.json`) and restart. Rotated refresh tokens: same manual update when logs tell you.

### I opened `/oauth/callback` and got **404**

Checklist:

1. Plugin **`enabled`: true** and **`oauthClientId`**, **`oauthClientSecret`**, **`oauthRedirectBaseUrl`** all non-empty (routes are omitted if any is missing).
2. **`oauthRedirectBaseUrl`** matches the **same host** you use in the browser (e.g. ngrok vs prod); mismatch often means nothing is listening on the host you think.
3. Tunnel points at the **correct port** for agent-detective.
4. After a **bare** `/oauth/callback` with no `code`, expect **400** JSON (“Missing code or state”), not 404—404 usually means wrong path or plugin not mounted.

### Comments still show my avatar after OAuth

You are on **`actor=user`** (default) or still using a **PAT**. Switch to **`oauthActor`: `"app"`**, re-run **`/oauth/start`**, store the **new** tokens, restart.

### What does `Linear-Delivery` / `webhookDeliveryDedupWindowMs` do?

Linear may **retry** the same HTTP delivery. **`Linear-Delivery`** identifies the attempt; the adapter skips duplicates within **`webhookDeliveryDedupWindowMs`** (default 10 minutes, **`0`** disables).

---

## Webhook URL and security

- **URL:** `POST https://<your-host>/plugins/agent-detective-linear-adapter/webhook/linear`
- **Signing:** set **`webhookSigningSecret`** (or **`LINEAR_WEBHOOK_SIGNING_SECRET`**). The adapter verifies **`Linear-Signature`** on the **raw** body and **`webhookTimestamp`** when verification is on.
- **Local dev:** `skipWebhookSignatureVerification: true` allows unsigned payloads (trusted networks only).

## Behavior (high level)

- **Canonical events:** `linear:Issue:create` and `linear:Comment:create`. Configure under **`webhookBehavior`** like Jira.
- **Actions:** `analyze`, `acknowledge`, `ignore`.
- **Triggers:** **`retryTriggerPhrase`** / **`prTriggerPhrase`** in comment bodies; loop protection via stamped footer + **`botActorIds`**.
- **Threading:** **`linearReplyParentId`** for analyze replies; PR fan-out can reply under the PR trigger comment when Linear sends a comment id.
- **`TASK_COMPLETED`:** posts results back to the issue when the task came from this plugin.

## Related references

- [Official bundled plugins](./plugins.md#14-official-bundled-plugins) (index).
- [Generated plugin options](../reference/generated/plugin-options.md) — every option key.
- [Manual E2E: Linear](../e2e/linear-manual-e2e.md) — tunnel + smoke checklist.
- [Configuration env whitelist](../config/configuration.md#plugin-env-whitelist-first-party) — **`LINEAR_*`** variables.
- Linear: [OAuth 2.0](https://developers.linear.app/docs/oauth/authentication), [OAuth actor](https://linear.app/developers/oauth-actor-authorization), [Webhooks](https://linear.app/developers/webhooks), [SDK](https://developers.linear.app/docs/sdk).
