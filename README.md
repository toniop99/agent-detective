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

# Build for production
pnpm build
```

## Packages

| Package | Description |
|---------|-------------|
| `agent-detective` | Main application (Express server) |
| `@agent-detective/types` | Shared TypeScript types |
| `@agent-detective/local-repos-plugin` | Local repository configuration |
| `@agent-detective/jira-adapter` | Jira webhook adapter |

## Configuration

See **[docs/configuration.md](docs/configuration.md)** for file precedence, env whitelist, and generated plugin schemas.

Configure via `config/default.json` (and optional `config/local.json`):

```json
{
  "port": 3001,
  "agent": "opencode",
  "plugins": [...]
}
```

## Documentation

- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Plugin Development](docs/plugins.md)
- [Development Guide](docs/development.md)
- [Docker & CI images](docs/docker.md)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.