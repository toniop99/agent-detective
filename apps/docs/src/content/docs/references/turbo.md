---
title: Turborepo
description: Cheat sheet for Turborepo task graph, caching, and common build commands.
sidebar:
  order: 3
---

# Turborepo (cheat sheet)

- **Tasks** are defined per package (`build`, `typecheck`, `lint`, `test`). Root runs **`turbo run <task>`** over the graph.
- **From root:** `pnpm run build` → `turbo run build`; `pnpm test` runs Turbo tests **and** root `test/**/*.test.ts`.
- **Cache:** Turbo caches task outputs; clean builds if you suspect stale artifacts: `pnpm run clean` (per package scripts).

More: [Development guide](https://github.com/toniop99/agent-detective/blob/main/docs/development/development.md).
