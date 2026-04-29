# Agent Detective — agent index

Short map for humans and coding agents. **Deep detail lives in `docs/`** — avoid growing this file into an encyclopedia; add prose under [`docs/`](docs/README.md) and link here.

## Project

TypeScript **pnpm 10** monorepo: **`packages/*`**, optional **`apps/*`** (Starlight **`apps/docs`**, landing **`apps/landing`**), **repo root** = main HTTP app. **Turborepo** runs `build` / `typecheck` / `lint` / `test` across packages; **`pnpm test`** runs Turbo tests then root **`test/**/*.test.ts`**. **TypeScript 6**, **Zod 4**, shared versions via **`catalog:`** in `pnpm-workspace.yaml`.

## Where to read

| Topic | Location |
|--------|-----------|
| **Boot, test, lint, smoke, logs** | [`docs/development/agent-harness.mdx`](docs/development/agent-harness.mdx) |
| **Subagents / skills (canonical)** | [`.agents/agents/`](.agents/agents/) · [`.agents/skills/`](.agents/skills/) · [`.agents/README.md`](.agents/README.md) · Cursor mirror: `pnpm run agents:sync-cursor` → `.cursor/` · [`docs/development/cursor-delegation.md`](docs/development/cursor-delegation.md) |
| **Suggested PR / agent loop** | [`docs/development/agent-workflow.md`](docs/development/agent-workflow.md) |
| **Execution plans, tech-debt notes** | `docs/exec-plans/` (optional tree; add `README.md` / `active/` when the team uses it) |
| **Short tool refs (pnpm, Turbo, ESM)** | [`docs/references/README.md`](docs/references/README.md) |
| **Do / don’t, plugins, common failures** | [`docs/development/agent-golden-rules.md`](docs/development/agent-golden-rules.md) |
| **pnpm, Turbo, layout, debugging** | [`docs/development/development.md`](docs/development/development.md) |
| **Doc map (operator, config, plugins, ADR)** | [`docs/README.md`](docs/README.md) |
| **Runtime config** | [`docs/config/configuration.md`](docs/config/configuration.md) · Zod: `src/config/schema.ts` |
| **Plugin guide** | [`docs/plugins/plugins.md`](docs/plugins/plugins.md) |
| **HTTP (Fastify) / OpenAPI** | [`src/server.ts`](src/server.ts) · [Plugins](docs/plugins/plugins.md) · [ADR 0001 — layering](docs/architecture/adr/0001-layering-and-plugin-boundaries.md) · [ADR 0002 — HTTP framework](docs/architecture/adr/0002-http-framework.md) |

**Starlight:** source prose is **`docs/**/*.md`**; sync → `apps/docs/src/content/docs/` via `pnpm run docs:site:sync`. Published: **https://agent-detective.chapascript.dev/docs/**. **`apps/docs/src/content/docs/index.mdx`** is hand-edited (not synced). **Pages:** `pnpm run docs:site:landing` merges landing into the same artifact — see [`apps/docs/README.md`](apps/docs/README.md).

## Plans

- When in plan mode and the user prompt starts with "Create a plan for" (in any language, e.g. "Crea un plan para", "Create a plan for"), read and follow `docs/development/plan-conventions.md` to structure the plan output. Otherwise, plan normally without those conventions.
- **Plan-only prompts (no code changes):** If the user asks for a plan in that style (or a similar wording such as "diseña un plan para", "plan para hacer que…"), treat **executing the plan** as **writing the plan document only**: create the file under `.agents/plans/` as described in `docs/development/plan-conventions.md` (not only in Cursor’s default `.cursor/plans/`). Do **not** implement features, run the app, or change application code unless the user **explicitly** asks to implement, execute, or apply the plan.
- **Implementing after a plan:** Only start coding when the user clearly requests implementation (e.g. "implementa el plan", "Implement the plan", "ejecuta el plan en código").

## Packages (`packages/*`)

| Package | Role |
|---------|------|
| `@agent-detective/types` | Host-internal type-only contract package (re-exported via sdk) |
| `@agent-detective/sdk` | Single plugin-author dependency: types + runtime helpers (`defineRoute`, `registerRoutes`, `definePlugin`, `zodToPluginSchema`) + service constants (`REPO_MATCHER_SERVICE`, `PR_WORKFLOW_SERVICE`, `StandardEvents`) |
| `@agent-detective/observability` | Logging, metrics, health |
| `@agent-detective/process-utils` | Process helpers |
| `@agent-detective/local-repos-plugin` | Repos + `RepoMatcher` |
| `@agent-detective/jira-adapter` | Jira integration |
| `@agent-detective/linear-adapter` | Linear webhooks + GraphQL (Phase B scaffold) |
| `@agent-detective/pr-pipeline` | PR workflow (issue tracker port) |

## Golden rules (summary)

**Do:** `@agent-detective/sdk` for plugin authoring (types + runtime + constants) · `@agent-detective/types` only inside the host · `.ts` / `.test.ts` · ESM **`from './x.js'`** · `pnpm run build` (+ `build:app` for root `dist/`).

**Don’t:** edit **`dist/`** · deep relatives from **`packages/*`** into root **`src/`** (CI rejects) · **`.js`** next to **`.ts`** · bad **`rootDir`**.

Full list: [`docs/development/agent-golden-rules.md`](docs/development/agent-golden-rules.md).

## Architecture (sketch)

Core: **agent runner**, **queue**, **HTTP server** (**Fastify** + Zod-typed routes via `defineRoute()` + `@fastify/swagger` → Scalar `/docs`), **plugin system** (schema validation + native Fastify `register({ prefix: '/plugins/{name}' })`). Plugins use **`TaskEvent`** and **`PluginContext`**. Shared types: **`packages/types/src/index.ts`**.

## Key files

| Path | Role |
|------|------|
| `src/core/plugin-system.ts` | Plugin load, `/plugins/{name}` prefix via `fastify.register`, `createPluginSystem` → `.enqueue` |
| `src/core/agent-runner.ts` | Agent execution |
| `src/server.ts` | Fastify app, Core API, docs route, OpenAPI (via `@fastify/swagger`) |
| `packages/core/src/route.ts` | `defineRoute` / `registerRoutes` (Zod-typed routes) |
| `packages/types/src/index.ts` | All shared interfaces |
| `docs/README.md` | Documentation map |

## Useful Commands

```bash
pnpm run build       # workspace packages
pnpm run build:app   # root dist/ for pnpm start
pnpm test
pnpm run lint        # turbo lint + import guards + docs link check
pnpm run docs:site:sync
pnpm run agents:sync-cursor # symlink .cursor/{agents,skills} → .agents/… (also postinstall)
```

