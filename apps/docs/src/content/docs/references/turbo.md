---
title: "Turborepo (cheat sheet)"
---

# Turborepo (cheat sheet)

- **Tasks** are defined per package (`build`, `typecheck`, `lint`, `test`). Root runs **`turbo run <task>`** over the graph.
- **From root:** `pnpm run build` → `turbo run build`; `pnpm test` runs Turbo tests **and** root `test/**/*.test.ts`.
- **Cache:** Turbo caches task outputs; clean builds if you suspect stale artifacts: `pnpm run clean` (per package scripts).

More: [Development guide](/docs/development/development/).
