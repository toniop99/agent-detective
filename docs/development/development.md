# Development Guide

**Agents and quick verify:** [Agent harness](./agent-harness.md) · **Do / don’t / pitfalls:** [Agent golden rules](./agent-golden-rules.md) · **Root index:** [AGENTS.md](../../AGENTS.md)

## Prerequisites

- Node.js 24+
- pnpm 10.33+ (see `packageManager` in the repo root `package.json`; Corepack / `pnpm/action-setup` use this pin)
- Access to repositories on local filesystem
- (Optional) Jira Cloud account for real integration
- (Optional) Docker — see [Docker & CI images](../operator/docker.md) for compose-based local dev

## Installation

```bash
cd agent-detective
pnpm install
```

## Configuration

See **[configuration-hub.md](../config/configuration-hub.md)** for load order and top-level keys, then **[configuration.md](../config/configuration.md)** for `default.json` / `local.json` merge rules, supported environment variables, and generated plugin option schemas.

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
          "failOnMissing": false
        }
      }
    },
    {
      "package": "@agent-detective/jira-adapter",
      "options": {
        "enabled": true,
        "mockMode": true
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

End-to-end Jira webhook testing (tunnel, labels, smoke script): [e2e/jira-manual-e2e.md](../e2e/jira-manual-e2e.md).

## Monorepo layout (pnpm + Turborepo)

- **Root** [`package.json`](../../package.json) is the **main Fastify app** (`src/`, `test/`). It is not a separate package under `packages/`, but it depends on workspace packages via `workspace:*`.
- **Workspace packages** live under [`packages/*`](../../packages/) and an optional app package under [`apps/*`](../../apps/) (the documentation site is in [`apps/docs`](../../apps/docs/)). All are listed in [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml). Shared dependency versions use the **`catalog:`** protocol defined in that file.
- **`pnpm run build`** runs **Turborepo** (`turbo run build`) and builds every workspace package’s `dist/`. It does **not** bundle the root server by itself.
- **`pnpm run build:app`** runs **tsup** on the root entrypoint and writes **`dist/index.js`** for `pnpm start` / production images (the Dockerfile runs both workspace build and `build:app`).
- **`pnpm run typecheck`** runs `turbo run typecheck` for packages **and** `tsc --noEmit` at the repo root for `src/` + `test/`.
- **`pnpm test`** runs **`turbo run test`** (package tests, e.g. `@agent-detective/jira-adapter`, with `^build` deps) then **root** tests with **tsx** on `test/**/*.test.ts`.
- **`pnpm run publish`** runs **Changesets** (`changeset publish`), not Turborepo.
- **Turborepo cache**: stored under **`.turbo/`** at the repo root. To discard local task cache: `rm -rf .turbo` (or `pnpm exec turbo daemon clean` if you use the daemon). **`pnpm run clean`** runs each package’s `clean` script (typically `rm -rf dist`) via `turbo run clean`.

### Workspace and tooling (detail)

`pnpm-workspace.yaml` lists only `packages/*` (the root app is not a subfolder package; it is the repo root with its own `package.json`).

**`turbo.json`** defines `build`, `typecheck`, `lint`, `test`, and `clean` with `dependsOn: ["^build"]` where needed so dependency packages build first.

**`tsup`** is used in packages for fast ESM + `dts` output; the root app uses `tsup` for `build:app` to emit `dist/index.js`.

| Command | Description |
|--------|-------------|
| `pnpm run build` | Build all workspace packages (Turbo, cached) |
| `pnpm run typecheck` | `turbo run typecheck` + root `tsc --noEmit` |
| `pnpm run test` | Package tests + root `test/**/*.test.ts` |
| `pnpm run clean` | Each package’s `clean` (e.g. `rm -rf dist`) |
| `pnpm run publish` (root) | Changesets: `changeset publish` (publishable **workspace** packages only) |

**Build order (conceptual):** `types` and `process-utils` have no workspace deps; `core` and `observability` depend on types; plugins depend on types/core/process-utils as declared in their `package.json`. Turbo resolves the graph via `^build`.

**New package:** create `packages/<name>/` with `package.json`, `tsup.config.ts`, `tsconfig.json` extending the repo base, and list workspace deps as `workspace:*`. See a sibling package (e.g. `packages/jira-adapter`) as a template.

**VS Code:** point TypeScript at the workspace SDK:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

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
│   │   ├── claude.ts
│   │   ├── cursor.ts
│   │   └── utils.ts
│   ├── server.ts                     # Fastify server (+ Core API endpoints)
│   └── index.ts                      # Bootstrap
├── packages/                         # Workspace packages
│   ├── types/                        # @agent-detective/types
│   ├── sdk/                          # @agent-detective/sdk (defineRoute, registerRoutes, zodToPluginSchema)
│   ├── observability/                # @agent-detective/observability
│   ├── process-utils/                # @agent-detective/process-utils
│   ├── local-repos-plugin/          # @agent-detective/local-repos-plugin
│   └── jira-adapter/                 # @agent-detective/jira-adapter
├── test/                             # Main app tests
│   └── core/
├── config/
│   └── default.json                  # Server configuration
└── docs/                             # Documentation (see README.md: operator, config, plugins, …)
```

## Running Plugin Tests

```bash
cd packages/jira-adapter
pnpm test
```

## Testing Jira Adapter (mock vs real)

When `mockMode: true`, the adapter uses `mock-jira-client.ts` and logs `[MOCK] Added comment...` instead of calling Jira.

When `mockMode: false`, set `baseUrl`, `email`, and `apiToken` (or `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`) so comments are posted via Jira REST ([real-jira-client.ts](../../packages/jira-adapter/src/infrastructure/real-jira-client.ts)).

```bash
# From repo root (server must be running on PORT)
pnpm run jira:webhook-smoke
```

## Debugging

### Enable debug logging

Set log level via `observability` in config or `OBSERVABILITY_LOG_LEVEL` / `LOG_LEVEL` (see [observability.md](../operator/observability.md)).

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

For a complete plugin development guide, see [plugins.md](../plugins/plugins.md).

Plugin authors import everything from `@agent-detective/sdk` (types and runtime helpers). `@agent-detective/types` is host-internal:

```typescript
import type { Plugin, PluginContext } from '@agent-detective/sdk';
```
