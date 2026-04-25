# Agent Detective

AI-powered code analysis that responds to events from Jira, Telegram, Slack, and other sources. Same product name as the root [README.md](../README.md).

## Install and run

- **[installation.md](installation.md)** — choose Docker/GHCR, Compose, or bare metal; links to the detailed guides
- **[configuration-hub.md](configuration-hub.md)** · **[upgrading.md](upgrading.md)** — config overview and staying current (with installation, these are the three **operator hubs**)

## Configuration

- **[configuration-hub.md](configuration-hub.md)** — load order, top-level app keys, links to the full reference and generated plugin options
- [configuration.md](configuration.md) — full detail (env, plugins, pr-pipeline)
- [generated/plugin-options.md](generated/plugin-options.md) — generated option reference for bundled plugins
- [upgrading.md](upgrading.md) — follow releases, pin container tags, runbook

## Concept

The core is **source-agnostic**: plugins normalize external events into a shared shape the server processes the same way.

## Workspace packages

| Package | Description |
|---------|-------------|
| Root app | Express server in `src/` (not under `packages/`) |
| `@agent-detective/types` | Shared types (`packages/types`) |
| `@agent-detective/core` | OpenAPI / controller utilities |
| `@agent-detective/observability` | Logging, metrics, health |
| `@agent-detective/process-utils` | Shell / process helpers |
| `@agent-detective/local-repos-plugin` | Local repos + label → repo `RepoMatcher` |
| `@agent-detective/jira-adapter` | Jira webhooks and REST client |

`@agent-detective/types` is published to npm; other packages are used via workspace or published per [publishing.md](publishing.md).

## Plugins

- Full guide: [plugins.md](plugins.md)
- **Custom / third-party:** [extending-with-plugins.md](extending-with-plugins.md) (install paths, registries, Docker)
- Authoring (TypeScript template): [plugin-development.md](plugin-development.md)
- Options reference: [generated/plugin-options.md](generated/plugin-options.md) (see also [Configuration](#configuration) above)
- Merge rules and env: [configuration.md](configuration.md); overview: [configuration-hub.md](configuration-hub.md)

`PluginContext` has **`getService` / `registerService`**, not a `plugins` map. For repos, consumers use the **local-repos** service or **`REPO_MATCHER_SERVICE`** (see [plugins.md](plugins.md)).

### Minimal `config` snippet

`repoContext` (e.g. `gitLogMaxCommits`) belongs under **local-repos-plugin** `options`, not at the root of `config/default.json`.

```json
{
  "port": 3001,
  "agent": "opencode",
  "plugins": [
    {
      "package": "@agent-detective/local-repos-plugin",
      "options": {
        "repos": [{ "name": "my-app", "path": "/path/to/repo" }],
        "repoContext": { "gitLogMaxCommits": 50 }
      }
    }
  ]
}
```

## Jira (local E2E)

- [e2e/README.md](e2e/README.md) — index
- [e2e/jira-manual-e2e.md](e2e/jira-manual-e2e.md) — webhook, tunnel, analyze flow
- [e2e/jira-pr-pipeline-manual-e2e.md](e2e/jira-pr-pipeline-manual-e2e.md) — Jira → PR pipeline

## Agents (shell CLIs)

- [cursor-agent.md](cursor-agent.md) — Cursor Agent CLI (`agent` binary, in-app id `cursor`)

## Development

[development.md](development.md) — pnpm, Turbo, `build` / `build:app`, tests.

## Historical migration notes

[migration.md](migration.md) — TypeScript migration and config moves (archive-style).
