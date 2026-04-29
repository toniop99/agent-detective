# Agent Detective

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

AI-powered code analysis agent that responds to events from Jira, Telegram, Slack and more.

## Concept

When a new incident is created in Jira, this agent analyzes the relevant repository to identify possible causes and writes a detailed comment to help developers resolve it.

## Architecture

Core agent logic is **source-agnostic** — plugins normalize events from different sources (Jira, Telegram, Slack) into a common format.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run in development
pnpm dev

# Build workspace packages (Turbo) + bundle the server (tsup)
pnpm build && pnpm run build:app
```

For day-to-day development you usually only need `pnpm dev`. CI runs `pnpm build` (packages) and `pnpm run build:app` (root `dist/`). See [Development Guide](docs/development/development.md#monorepo-layout-pnpm--turborepo).

## Packages

| Package | Description |
|---------|-------------|
| Root app | Fastify server (`src/`, not under `packages/`) |
| `@agent-detective/types` | Host-internal type-only contract package (re-exported through `@agent-detective/sdk`; plugins should not depend on it directly) |
| `@agent-detective/sdk` | Plugin-author SDK — single dependency for plugins. Bundles `defineRoute`, `registerRoutes`, `definePlugin`, `zodToPluginSchema`, service-name constants (`REPO_MATCHER_SERVICE`, `PR_WORKFLOW_SERVICE`), `StandardEvents`, and re-exports every plugin-facing type from `@agent-detective/types` |
| `@agent-detective/observability` | Logging, metrics, health |
| `@agent-detective/process-utils` | Process / shell helpers |
| `@agent-detective/local-repos-plugin` | Local repositories + `RepoMatcher` |
| `@agent-detective/jira-adapter` | Jira webhook adapter |
| `@agent-detective/linear-adapter` | Linear webhooks + OAuth, signature verification, deduplication; posts analysis back on task completion ([E2E](docs/e2e/linear-manual-e2e.md)) |

## Configuration

Start with **[docs/config/configuration-hub.md](docs/config/configuration-hub.md)** (load order and top-level keys), then **[docs/config/configuration.md](docs/config/configuration.md)** for the full env and plugin tables, **[docs/reference/generated/app-config.md](docs/reference/generated/app-config.md)** for the top-level app schema (Zod/JSON), and **[docs/reference/generated/plugin-options.md](docs/reference/generated/plugin-options.md)** for bundled plugin fields.

Configure via `config/default.json` (and optional `config/local.json`):

```json
{
  "port": 3001,
  "agent": "opencode",
  "plugins": [...]
}
```

## Run in production

Use a **native binary** from GitHub Releases, **build from source** (`pnpm start`), or follow the **bare-metal** guide (systemd + nginx). See [docs/operator/installation.md](docs/operator/installation.md). Install the agent CLI you configure (for example **OpenCode** per [OpenCode’s install guide](https://opencode.ai/docs)) on the host so `PATH` matches `config` (`agent` / `opencode` / etc.).

**First-time path:** [Golden path (≈15 min)](docs/operator/golden-path.md) · [Threat model (operators)](docs/operator/threat-model.md)

## Support matrix

| Dimension | Supported / tested in CI (typical) | Notes |
|-----------|--------------------------------------|--------|
| **Runtime** | Node.js **24+** (from source); **native binary** (Linux x64 in releases) | See [package.json](package.json) `engines` / `packageManager`. |
| **Host OS** | **Linux** for production guides (systemd + nginx) | macOS/Windows OK for dev; WSL acceptable for local smoke. |
| **HTTP server** | **Fastify** on configurable `port` (default **3001**) | `/api/health`, `/api/metrics`, Scalar `/docs`. |
| **Agent CLIs** | **OpenCode** documented; **Claude** / **Cursor** agent ids registered in-repo | Match `config.agent` to an installed CLI; see [cursor-agent.md](docs/development/cursor-agent.md) for Cursor. |
| **Jira** | **Jira Cloud** webhooks + REST (Basic or OAuth 2.0 3LO) | Webhook + Automation shapes per [jira-manual-e2e.md](docs/e2e/jira-manual-e2e.md). **Data Center** not separately certified—treat as best-effort if APIs align. |
| **Linear** | **Linear** webhooks + GraphQL comments (OAuth or PAT) | [linear-manual-e2e.md](docs/e2e/linear-manual-e2e.md), [linear-adapter.md](docs/plugins/linear-adapter.md). |
| **Kubernetes / Helm** | **Not shipped** in-repo | Bring your own container or VM; see [installation.md](docs/operator/installation.md#kubernetes). |

## Documentation

- **Documentation site (Starlight):** `pnpm run docs:site` from the root builds the static site in [`apps/docs/`](apps/docs/README.md) (source markdown is [`docs/`](docs/README.md); a [sync script](scripts/sync-starlight-content.mjs) runs on build). **Published:** [https://agent-detective.chapascript.dev/docs/](https://agent-detective.chapascript.dev/docs/) (GitHub Pages + [custom domain in repo settings](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site), DNS in Cloudflare). **GitHub Actions** is the Pages source. CI: [.github/workflows/docs-site.yml](.github/workflows/docs-site.yml).

- [Installation](docs/operator/installation.md) — native binary, from source, or bare metal
- [Configuration (overview)](docs/config/configuration-hub.md) — [full reference](docs/config/configuration.md)
- [Upgrading](docs/operator/upgrading.md) — releases and upgrade runbook
- [Architecture](docs/architecture/architecture.md)
- [Extending with custom plugins](docs/plugins/extending-with-plugins.md) — npm, paths, private registry
- [Plugin development (full guide)](docs/plugins/plugins.md)
- [Development Guide](docs/development/development.md)
- [Jira E2E (manual walkthroughs)](docs/e2e/) — webhooks, tunnel, pr-pipeline

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.