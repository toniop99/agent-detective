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

For day-to-day development you usually only need `pnpm dev`. CI and release images run `pnpm build` (packages) and `pnpm run build:app` (root `dist/`). See [Development Guide](docs/development.md#monorepo-layout-pnpm--turborepo).

## Packages

| Package | Description |
|---------|-------------|
| Root app | Express server (`src/`, not under `packages/`) |
| `@agent-detective/types` | Shared TypeScript types |
| `@agent-detective/core` | OpenAPI / controller utilities |
| `@agent-detective/observability` | Logging, metrics, health |
| `@agent-detective/process-utils` | Process / shell helpers |
| `@agent-detective/local-repos-plugin` | Local repositories + `RepoMatcher` |
| `@agent-detective/jira-adapter` | Jira webhook adapter |

## Configuration

Start with **[docs/configuration-hub.md](docs/configuration-hub.md)** (load order and top-level keys), then **[docs/configuration.md](docs/configuration.md)** for the full env and plugin tables, and **[docs/generated/plugin-options.md](docs/generated/plugin-options.md)** for bundled plugin fields.

Configure via `config/default.json` (and optional `config/local.json`):

```json
{
  "port": 3001,
  "agent": "opencode",
  "plugins": [...]
}
```

## Run from GitHub Container Registry

Use the production image when you do not need a local clone for development:

```bash
docker pull ghcr.io/toniop99/agent-detective:latest
docker run -d -p 3001:3001 \
  -v "$(pwd)/config:/app/config:ro" \
  -e NODE_ENV=production \
  ghcr.io/toniop99/agent-detective:latest
```

Then check `http://localhost:3001/api/health`. The production image bundles the OpenCode CLI as `opencode` (installed from the npm package **`opencode-ai`** per [OpenCode’s install guide](https://opencode.ai/docs)). Configure providers and API keys per OpenCode; any `-e` variables you pass into the container are visible to that CLI.

For Compose (pull only, no build), use [docker-compose.ghcr.yml](docker-compose.ghcr.yml). Full detail: [docs/docker.md](docs/docker.md#published-image-ghcr).

## Documentation

- [Installation](docs/installation.md) — deploy with Docker, from source, or bare metal
- [Configuration (overview)](docs/configuration-hub.md) — [full reference](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Plugin Development](docs/plugins.md)
- [Development Guide](docs/development.md)
- [Docker & CI images](docs/docker.md)
- [Jira manual E2E (webhook + tunnel)](docs/jira-manual-e2e.md)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.