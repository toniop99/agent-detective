# Development Guide

## Prerequisites

- Node.js 24+
- pnpm 10.33+ (see `packageManager` in the repo root `package.json`; Corepack / `pnpm/action-setup` use this pin)
- Access to repositories on local filesystem
- (Optional) Jira Cloud account for real integration
- (Optional) Docker — see [Docker & CI images](docker.md) for compose-based local dev

## Installation

```bash
cd agent-detective
pnpm install
```

## Configuration

See **[configuration.md](configuration.md)** for `default.json` / `local.json` merge rules, supported environment variables, and generated plugin option schemas.

### Edit `config/default.json`

```json
{
  "port": 3001,
  "agent": "opencode",
  "plugins": [
    {
      "package": "@agent-detective/local-repos-plugin",
      "options": {
        "repos": [
          {
            "name": "my-project",
            "path": "/path/to/your/project",
            "description": "Your project description"
          }
        ],
        "techStackDetection": {
          "enabled": true
        },
        "validation": {
          "validateOnStartup": true,
          "failOnMissing": false
        }
      }
    },
    {
      "package": "@agent-detective/jira-adapter",
      "options": {
        "enabled": true,
        "webhookPath": "/plugins/agent-detective-jira-adapter/webhook/jira",
        "mockMode": true,
        "discovery": {
          "enabled": true,
          "useAgentForDiscovery": true,
          "directMatchOnly": false,
          "fallbackOnNoMatch": "ask-agent"
        }
      }
    }
  ]
}
```

## Running

```bash
# Production
pnpm start

# Development (with auto-reload using tsx)
pnpm run dev
```

## Monorepo layout (pnpm + Turborepo)

- **Root** [`package.json`](../package.json) is the **main Express app** (`src/`, `test/`). It is not a separate package under `packages/`, but it depends on workspace packages via `workspace:*`.
- **Workspace packages** live under [`packages/*`](../packages/) and are listed in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) (only `packages/*`; add `apps/*` later if you introduce an app package). Shared dependency versions use the **`catalog:`** protocol defined in that file.
- **`pnpm run build`** runs **Turborepo** (`turbo run build`) and builds every workspace package’s `dist/`. It does **not** bundle the root server by itself.
- **`pnpm run build:app`** runs **tsup** on the root entrypoint and writes **`dist/index.js`** for `pnpm start` / production images (the Dockerfile runs both workspace build and `build:app`).
- **`pnpm run typecheck`** runs `turbo run typecheck` for packages **and** `tsc --noEmit` at the repo root for `src/` + `test/`.
- **`pnpm test`** runs **`turbo run test`** (package tests, e.g. `@agent-detective/jira-adapter`, with `^build` deps) then **root** tests with **tsx** on `test/**/*.test.ts`.
- **`pnpm run publish`** runs **Changesets** (`changeset publish`), not Turborepo.
- **Turborepo cache**: stored under **`.turbo/`** at the repo root. To discard local task cache: `rm -rf .turbo` (or `pnpm exec turbo daemon clean` if you use the daemon). **`pnpm run clean`** runs each package’s `clean` script (typically `rm -rf dist`) via `turbo run clean`.

## Building

```bash
# Build all workspace packages (Turborepo, cached)
pnpm run build

# Bundle the root server to dist/ (production entrypoint)
pnpm run build:app

# TypeScript type checking (packages via Turbo + root tsc)
pnpm run typecheck

# ESLint (all packages that define a lint script)
pnpm run lint

# Remove dist/ in packages (turbo run clean)
pnpm run clean
```

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm run test:watch
```

## Project Structure

```
agent-detective/
├── src/                              # Main application (TypeScript)
│   ├── core/
│   │   ├── types.ts                  # Re-exports from @agent-detective/types
│   │   ├── agent-runner.ts           # Executes prompts against AI agents
│   │   ├── queue.ts                  # Task queuing (prevents parallel execution)
│   │   ├── process.ts                # Shell command execution
│   │   ├── plugin-system.ts          # Plugin loader & registry
│   │   └── schema-validator.ts       # Plugin schema validation
│   ├── agents/                       # AI agent integrations
│   │   ├── index.ts                  # Agent registry
│   │   ├── opencode.ts
│   │   ├── codex.ts
│   │   ├── codex-app.ts
│   │   ├── claude.ts
│   │   ├── gemini.ts
│   │   └── utils.ts
│   ├── server.ts                     # Express server (+ Core API endpoints)
│   └── index.ts                      # Bootstrap
├── packages/                         # Workspace packages
│   ├── types/                        # @agent-detective/types (shared types)
│   │   ├── src/index.ts              # SINGLE SOURCE OF TRUTH for types
│   │   └── dist/                     # Built output for npm
│   ├── local-repos-plugin/          # Repository management plugin
│   │   ├── src/
│   │   │   ├── index.ts              # Plugin entry
│   │   │   ├── types.ts              # LocalReposConfig, ValidatedRepo interfaces
│   │   │   ├── validate.ts           # Path validation
│   │   │   ├── tech-stack-detector.ts # Auto-detect tech stack
│   │   │   └── repo-context/        # Git log + file search
│   │   └── dist/
│   └── jira-adapter/                 # Official Jira plugin
│       ├── src/
│       │   ├── index.ts              # Plugin entry
│       │   ├── types.ts              # JiraAdapterConfig, discovery prompts
│       │   ├── discovery.ts          # Repo discovery logic
│       │   ├── webhook-handler.ts   # Webhook processing
│       │   ├── normalizer.ts        # Jira payload → TaskEvent
│       │   └── mock-jira-client.ts # In-memory Jira client
│       └── dist/
├── test/                             # Main app tests
│   └── core/
├── config/
│   └── default.json                  # Server configuration
└── docs/                             # Documentation
```

## Running Plugin Tests

```bash
cd packages/jira-adapter
pnpm test
```

## Testing Jira Adapter with Mock Mode

When `mockMode: true` in plugin config, the adapter uses `mock-jira-client.ts` which stores comments in memory:

```bash
# Test webhook locally
curl -X POST http://localhost:3001/plugins/agent-detective-jira-adapter/webhook/jira \
  -H "Content-Type: application/json" \
  -d @packages/jira-adapter/test/fixtures/issue-created.json
```

## Debugging

### Enable Debug Logging

The core modules use `console.info`/`console.warn` for operational logging.

### Common Issues

**Port already in use**
```bash
lsof -ti:3001 | xargs kill
```

**Plugin fails to load**
Check the console output - plugins log warnings instead of crashing.

**Repository not found**
- Verify `config/default.json` has correct repo paths
- Ensure the agent has read permissions on the repo directory

**Agent not responding**
- Check the agent is installed and on PATH
- Try running standalone: `echo "hello" | opencode exec "say hi"`

## Creating a New Plugin

For a complete plugin development guide, see [docs/plugins.md](plugins.md).

For type definitions, plugins should import from `@agent-detective/types`:

```typescript
import type { Plugin, PluginContext } from '@agent-detective/types';
```
