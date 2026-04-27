# Manual E2E: Linear webhook → local server

Short checklist to verify **`@agent-detective/linear-adapter`** end-to-end. For full plugin behavior and env tables, see [linear-adapter.md](../plugins/linear-adapter.md).

## Prerequisites

1. **Node** + **pnpm** — [development.md](../development/development.md).
2. **Linear** workspace permission to create **webhooks** and either a **PAT** or an **OAuth** app + tokens.
3. **Tunnel** (ngrok, Cloudflare Tunnel, …) exposing your local HTTP port if Linear cannot reach `localhost`.
4. **local-repos-plugin** configured with a repo whose **`name`** matches a **label** you will put on a test issue.

## Webhook URL

Register Linear → **Settings** → **API** → **Webhooks** (or team settings, depending on your Linear UI) with:

`https://<public-host>/plugins/agent-detective-linear-adapter/webhook/linear`

Subscribe to events that produce **`Issue`** / **`Comment`** creates (same semantics as in [resolve-linear-event](../../packages/linear-adapter/src/application/resolve-linear-event.ts): e.g. issue created, comment created).

## Configuration (minimal)

Use **`config/local.json`** (gitignored) for secrets. Enable the plugin, set **`apiKey`** (PAT) or OAuth fields per [linear-adapter.md](../plugins/linear-adapter.md).

- Set **`webhookSigningSecret`** from Linear and **do not** set `skipWebhookSignatureVerification` in production.
- For local unsigned tests only: `skipWebhookSignatureVerification: true`.

## Smoke steps

1. Start the app (`pnpm dev` or your Docker compose) and confirm logs show **`Linear adapter registered`** with the webhook path.
2. Create a Linear **issue** with a label matching a configured repo **`name`**.
3. Confirm an analysis task is enqueued (or, with **`mockMode: true`**, that the adapter logs mock comment / processing without calling Linear for writes).
4. Add a comment containing **`#agent-detective analyze`** (or your `retryTriggerPhrase`) and confirm a retry / analyze path runs.
5. (Optional) Trigger **`#agent-detective pr`** with **`@agent-detective/pr-pipeline`** enabled and VCS configured on the repo.
6. Replay the same webhook (same **`Linear-Delivery`** within the dedup window) and confirm the adapter logs a **duplicate skip** instead of double work.

## OAuth smoke

1. Set `oauthClientId`, `oauthClientSecret`, `oauthRedirectBaseUrl` on the host; register the same redirect URL in the Linear OAuth app.
2. Open **`GET …/oauth/start`** in a browser; complete Linear consent.
3. Copy **`access_token`** → `LINEAR_API_KEY` / `apiKey`, **`refresh_token`** → `LINEAR_OAUTH_REFRESH_TOKEN`, restart the app, and confirm issue fetch + comment post work without storing the PAT.
