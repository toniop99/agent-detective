---
title: "Migration and history (archive)"
description: Breaking changes, removed APIs, and notable migration notes for the codebase.
sidebar:
  order: 6
---

# Migration and history (archive)

The codebase is **TypeScript** with shared types in `@agent-detective/types`. This page lists **breaking or notable changes**; for day-to-day setup use [development.md](development.md) and [configuration.md](../config/configuration.md). For how to follow releases and upgrade deploys, see [upgrading.md](../operator/upgrading.md).

## Config: `repoContext` location

`gitLogMaxCommits` and related **local-repos** options live under **`plugins[]` → `@agent-detective/local-repos-plugin` → `options`**, not as a root `repoContext` key in `config/default.json`.

## Removed: file search in repo context

`searchPatterns`, `searchFiles`, and related APIs were removed. `BuildRepoContextOptions` extends git tuning (`maxCommits`, timeouts, `diffFromRef`, `logger`) — not arbitrary file search. Agents are expected to search the tree themselves.

## Imports

Use **`@agent-detective/types`** (and workspace packages) — not deep imports into `src/core/` from plugins.

## Build commands (correct)

```bash
pnpm install
pnpm run build          # all workspace packages (Turbo)
pnpm run build:app      # bundle root app → dist/
```

There is no `build:plugin` script; build individual packages with `pnpm --filter <name> build` if needed.

## Further detail

- [Observability](../operator/observability.md) — logging/metrics package
- Git history for the full 2026 migration narrative and older edits

**Breaking config changes** from recent cleanups are listed in the repo **CHANGELOG** (if present) or release notes; see `docs/reference/CHANGELOG.md` when upgrading.
