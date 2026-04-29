---
name: agent-detective-plugin-author
description: >-
  Guides Agent Detective plugin and monorepo work: @agent-detective/sdk usage,
  getService boundaries, routes, and ADR 0001. Use when authoring or refactoring
  packages under packages/*, HTTP plugin routes, or shared types. Pair with
  plugin-boundary-auditor and package-implementer subagents.
---

# Agent Detective — plugin author

## When to use

- Adding or changing a plugin under `packages/*`.
- Wiring `getService`, `dependsOn`, or shared ports.
- Defining HTTP routes with `defineRoute` / `registerRoutes`.

## Rules (summary)

- Single dependency for plugin code: **`@agent-detective/sdk`** (re-exports types and helpers). Do not compile-import **`@agent-detective/types`** in plugin packages.
- **No compile-time imports between plugin packages**; use types/sdk + **`getService()`** at runtime. Full rationale: `docs/architecture/adr/0001-layering-and-plugin-boundaries.md`.
- Do not deep-import root **`src/`** from `packages/*` (CI rejects).
- Routes register on the scoped Fastify instance; public prefix is `/plugins/{sanitized-name}`.

## Delegation

- Before merge or after cross-package edits: **`plugin-boundary-auditor`** subagent.
- For isolated implementation in one package with clear criteria: **`package-implementer`** subagent.

Subagent definitions: **`.agents/agents/*.md`** (canonical); Cursor mirrors under **`.cursor/agents/`** after `pnpm install` or **`pnpm run agents:sync-cursor`** (same `name` in frontmatter).

## Deep reference

- `docs/development/agent-golden-rules.md`
- `docs/plugins/plugins.md`
