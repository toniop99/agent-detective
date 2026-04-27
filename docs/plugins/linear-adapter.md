# Linear adapter (`@agent-detective/linear-adapter`)

Bundled plugin that receives **Linear webhooks**, matches issues to local repos via **labels** (same idea as the Jira adapter), and fans out **code analysis** tasks or the **PR pipeline** when `@agent-detective/pr-pipeline` is installed.

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

Set **`enabled`: true** and provide credentials (see below). **`mockMode`: true** logs comment actions instead of calling the Linear API for writes; issue reads still use the API unless you rely on OAuth-only bootstrap without a token (not typical for `mockMode` tests).

## Credentials: personal API key vs OAuth

| Mode | Config / env | `LinearClient` |
|------|----------------|----------------|
| **Personal API key (PAT)** | `apiKey` or **`LINEAR_API_KEY`** | `apiKey` |
| **OAuth access + refresh** | `apiKey` (or `LINEAR_API_KEY`) = access token, plus **`oauthClientId`**, **`oauthClientSecret`**, **`oauthRefreshToken`** (or env equivalents) | `accessToken` + refresh on expiry / auth errors |

- **PAT:** create a key under Linear → Settings → **API** → Personal API keys. Set `apiKey` or `LINEAR_API_KEY` only (no OAuth fields required).
- **OAuth (recommended for production):**
  1. Create an OAuth application in Linear (redirect URI must match what you configure on the host).
  2. Visit **`GET /plugins/agent-detective-linear-adapter/oauth/start`** on your deployed host (browser) after setting `oauthClientId`, `oauthClientSecret`, and **`oauthRedirectBaseUrl`** (public origin, no trailing slash). Linear redirects to **`/plugins/agent-detective-linear-adapter/oauth/callback`** with `code` and `state`.
  3. The callback returns JSON with **`access_token`** and **`refresh_token`** (and optional `expires_in`). Copy secrets into env (preferred) or `local.json` (gitignored):
     - **`LINEAR_API_KEY`** → current access token.
     - **`LINEAR_OAUTH_REFRESH_TOKEN`** → refresh token.
     - **`LINEAR_OAUTH_CLIENT_ID`** / **`LINEAR_OAUTH_CLIENT_SECRET`** → app credentials.
  4. If Linear **rotates** the refresh token, the adapter logs a warning; **update `LINEAR_OAUTH_REFRESH_TOKEN`** (the process does not write config files).

You may omit **`apiKey`** when the three OAuth fields plus refresh token are set: the adapter performs one **refresh_token** grant at startup to obtain the first access token.

See the [plugin env whitelist](../config/configuration.md#plugin-env-whitelist-first-party) table for all **`LINEAR_*`** variables.

## Webhook URL and security

- **URL:** `POST https://<your-host>/plugins/agent-detective-linear-adapter/webhook/linear`
- **Signing:** set **`webhookSigningSecret`** (or **`LINEAR_WEBHOOK_SIGNING_SECRET`**) from the Linear webhook settings. The adapter verifies the **`Linear-Signature`** header against the **raw** JSON body and checks **`webhookTimestamp`** freshness when verification is enabled.
- **Local dev:** `skipWebhookSignatureVerification: true` allows unsigned payloads (use only on trusted networks).
- **Idempotency:** Linear sends a **`Linear-Delivery`** header (unique per delivery attempt). The adapter keeps a short in-memory dedup window (**`webhookDeliveryDedupWindowMs`**, default 10 minutes; set **`0`** to disable) so HTTP retries do not double-run handlers.

## Behavior (high level)

- **Canonical events:** `linear:Issue:create` and `linear:Comment:create` (from payload `type` + `action`). Configure per-event actions under **`webhookBehavior`** (defaults + `events` map), same pattern as Jira.
- **Actions:** `analyze` (label match → `TASK_CREATED` per repo, or missing-labels reminder), `acknowledge` (single comment), `ignore`.
- **Triggers:** comment body contains **`retryTriggerPhrase`** (default `#agent-detective analyze`) or **`prTriggerPhrase`** (default `#agent-detective pr`). Adapter- and bot-authored comments are filtered using the stamped marker and optional **`botActorIds`** (Linear `actor.id` values from webhooks).
- **Threading:** analyze replies can use **`linearReplyParentId`** in task metadata so results reply under the triggering comment. PR fan-out posts its “starting PR” / missing **pr-pipeline** notes as **replies** to the PR trigger comment when Linear provides a comment id.
- **`TASK_COMPLETED`:** when the completed task came from this plugin and `replyTo.type === 'issue'`, the adapter posts the result back to the issue (and respects `linearReplyParentId` in metadata when set).

## Related references

- [Official bundled plugins](./plugins.md#14-official-bundled-plugins) (index) — short summary next to Jira.
- [Generated plugin options](../reference/generated/plugin-options.md) — every Zod field for `@agent-detective/linear-adapter`.
- [Manual E2E: Linear](../e2e/linear-manual-e2e.md) — tunnel, webhook, and smoke checklist.
- Linear docs: [OAuth](https://developers.linear.app/docs/oauth/authentication), [Webhooks](https://linear.app/developers/webhooks), [SDK](https://developers.linear.app/docs/sdk).
