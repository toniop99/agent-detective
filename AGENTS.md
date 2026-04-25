# Agent Detective - Quick Reference

## Project

TypeScript monorepo (**pnpm** 10): **`packages/*`**, optional **`apps/*`** (e.g. **Starlight** docs in `apps/docs`), **root** = main Express app. **Turborepo** runs `build` / `typecheck` / `lint` / `clean` / `test` (where defined) across packages; **`pnpm test`** runs `turbo run test` then root `tsx` tests. Shared versions use **`catalog:`** in `pnpm-workspace.yaml`. **TypeScript 6** + **Zod 4** at the repo root and in packages. See `docs/development/development.md` (Monorepo layout).

## Documentation

- **Prose in git** lives under `docs/`, grouped for operators and authors: `docs/operator/` (install, deploy, docker, upgrade, observability), `docs/config/` (hub + full reference), `docs/plugins/`, `docs/development/`, `docs/architecture/` (includes `adr/`), `docs/e2e/`, `docs/reference/` (CHANGELOG + `reference/generated/*` from `pnpm docs:config` / `pnpm docs:plugins`). Start from `docs/README.md`.
- **Starlight static site** is `apps/docs/` (Astro + `@astrojs/starlight` + MDX). The **published** URL uses GitHub project Pages (see root `README.md`); `site` / `base` in `apps/docs/astro.config.mjs` must match the deployment (forks may need changes).
- **Source of truth for markdown content** is always `docs/**/*.md` in the repo. `scripts/sync-starlight-content.mjs` copies that tree into `apps/docs/src/content/docs/` (mirrors paths), rewrites links for the site, and maps `docs/README.md` → `overview`. It **does not** overwrite the Starlight home: `apps/docs/src/content/docs/index.mdx` (journey + `LinkCard` grid) is hand-edited in `apps/docs` only.
- **Commands (repo root):** `pnpm run docs:site:sync` (sync only), `pnpm run docs:site:dev` (dev server), `pnpm run docs:site` (production build), `pnpm docs:config` / `pnpm docs:plugins` (regenerate `docs/reference/generated/*.md`). CI runs `docs:config:check` and `docs:plugins:check`; the docs site workflow builds `apps/docs` on pushes affecting docs or the sync script.

**Packages** (`packages/*`):
- `@agent-detective/types` — Shared types (single source of truth)
- `@agent-detective/core` — OpenAPI / controller utilities
- `@agent-detective/observability` — Logging, metrics, health
- `@agent-detective/process-utils` — Process helpers
- `@agent-detective/local-repos-plugin` — Repository + `RepoMatcher` service
- `@agent-detective/jira-adapter` — Jira integration
- `@agent-detective/pr-pipeline` — Jira comment PR workflow (worktree, push, GitHub PR)

## Configuration

Runtime config: `config/default.json` + optional `config/local.json` (deep merge), then an explicit env whitelist — see `docs/config/configuration.md`. Top-level app Zod: `src/config/schema.ts` (`pnpm docs:config` → `docs/reference/generated/app-config.md`). Plugin option Zod: `packages/jira-adapter/src/application/options-schema.ts`, `packages/local-repos-plugin/src/application/options-schema.ts`, `packages/pr-pipeline/src/application/options-schema.ts` (`pnpm docs:plugins` → `docs/reference/generated/plugin-options.md`).

## Golden Rules

### DO
- Import shared types from `@agent-detective/types`
- Use `.ts` for source files, `.test.ts` for tests
- Use ESM with `.js` extension in imports (e.g., `from './foo.js'`)
- Build packages before publishing: `pnpm run build` (and `pnpm run build:app` for the root `dist/` bundle used by `pnpm start` / Docker production)

### DON'T
- Edit `dist/` files (generated output)
- Use relative imports like `../../../src/core/types.js`
- Create `.js` files alongside `.ts` files
- Set `rootDir` to include multiple directories

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                        Core                          │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │Agent Runner │  │    Queue    │  │   Server   │  │
│  │             │  │  (taskId)   │  │  (Express) │  │
│  └─────────────┘  └─────────────┘  └────────────┘  │
│  ┌─────────────────────────────────────────────┐   │
│  │       Plugin System (schema validation)      │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                            ▲
     ┌──────────────────────┼──────────────────────┐
     │                      │                      │
     │         ┌────────────┴────────────┐       │
     │         │  TaskEvent normalization  │       │
     │         └───────────────────────────┘       │
     │                      │                      │
     │   local-repos-plugin  │  jira-adapter (etc) │
     └──────────────────────┴──────────────────────┘
```

## Key Types

**All shared types:** `packages/types/src/index.ts`

```typescript
interface Plugin {
  name: string;
  version: string;
  schemaVersion?: '1.0';
  schema?: PluginSchema;
  dependsOn?: string[];           // Loaded before this plugin
  register(app: Application, context: PluginContext): void;
}

interface PluginContext {
  agentRunner: AgentRunner;       // Always available
  enqueue: EnqueueFn;              // Stable delegate to active TaskQueue
  registerTaskQueue(queue: TaskQueue): void;
  registerService<T>(name: string, service: T): void;
  getService<T>(name: string): T;
  registerCapability(capability: string): void;
  hasCapability(capability: string): boolean;
  config: object;                  // Validated config
  logger: Logger;                  // info/warn/error
}

interface TaskEvent {
  source: string;
  type: string;
  payload: unknown;
  timestamp?: string;
}
```

## Plugin Development

### Route Prefixing
Plugin routes are auto-prefixed with `/plugins/{sanitized-name}`:

| Plugin Name | Prefix |
|-------------|--------|
| `@agent-detective/jira-adapter` | `/plugins/agent-detective-jira-adapter` |
| `my-plugin` | `/plugins/my-plugin` |

Register routes with relative paths - prefix is applied automatically.

### Plugin Dependencies
Use `dependsOn` to ensure plugins load in order and services are available:
```typescript
{
  name: '@agent-detective/my-adapter',
  dependsOn: ['@agent-detective/local-repos-plugin'],
  register(app, context) {
    const localReposService = context.getService<LocalReposService>('@agent-detective/local-repos-plugin');
    // localReposService.localRepos, localReposService.buildRepoContext available here
  }
}
```

## Project Structure

```
src/
├── core/
│   ├── agent-runner.ts      # Execute AI agents
│   ├── plugin-system.ts      # Plugin loading + route prefixing
│   ├── queue.ts              # Task queuing
│   └── types.ts              # Re-exports from @agent-detective/types
├── agents/                   # AI agent integrations
├── server.ts                 # Express + Core API endpoints
└── index.ts                  # Bootstrap

packages/
├── types/src/index.ts
├── core/src/
├── observability/src/
├── process-utils/src/
├── local-repos-plugin/src/   # presentation / application / domain / infrastructure
└── jira-adapter/src/

test/                         # *.test.ts files (tsx --test)

docs/                         # See “Documentation” above (operator, config, plugins, …)
```

## Docker

See [docs/operator/docker.md](docs/operator/docker.md): `docker compose` for local **dev** (bind mounts), `docker-compose.prod.yml` for **production** image, and GitHub Actions workflows for GHCR.

## Essential Commands

```bash
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm run lint     # Lint all packages
pnpm run lint -- --fix   # Auto-fix lint issues
pnpm turbo clean  # Clear build cache if odd issues occur
```

## Common Failures

### "Cannot find module '@agent-detective/types'"
**Cause:** Used relative path instead of package import.
**Fix:** Use `@agent-detective/types` - it resolves via workspace.

### Plugin build fails / "rootDir is outside rootDir"
**Cause:** Plugin imports from `../../../src/core/types.js`.
**Fix:** Use `@agent-detective/types` - relative paths to src/ break standalone builds.

### Tests not running / duplicate output
**Cause:** Old `.js` test files alongside `.ts` files.
**Fix:** Delete old `.js` test files. Only `*.test.ts` should exist.

### Module not found after build
**Cause:** Using wrong ESM extension or missing `"type": "module"`.
**Fix:** All imports must use `.js` extension; check package.json.

## Key Files

| File | Purpose |
|------|---------|
| `packages/types/src/index.ts` | All shared type definitions |
| `src/core/plugin-system.ts` | Plugin loading; `createPluginSystem({ agentRunner, events, taskQueue? })` returns `.enqueue` |
| `src/core/agent-runner.ts` | Agent execution |
| `docs/README.md` | Map of the `docs/` tree (operator, config, plugins, …) |
| `docs/plugins/plugins.md` | Full plugin development guide |
| `docs/plugins/publishing.md` | Package publishing workflow |
| `apps/docs/astro.config.mjs` | Starlight sidebar, `site` / `base` for GitHub Pages |
| `apps/docs/src/content/docs/index.mdx` | Doc site home (not synced from `docs/`) |
| `scripts/sync-starlight-content.mjs` | Mirror `docs/**` into the Starlight content dir |
