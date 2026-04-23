# Layering and hexagonal-style layout

This repository uses a **pragmatic hexagonal (ports & adapters) + layered** layout inside workspace packages.

## Concepts

- **Ports** — Interfaces and DTOs in [`@agent-detective/types`](../packages/types/src/index.ts) (`TaskEvent`, `AgentRunner`, `RepoMatcher`, `PrWorkflowService`, etc.).
- **Driving adapters** — HTTP entry points (e.g. Jira webhook controller).
- **Application** — Use cases: webhook dispatch, handler routing, config schemas for a plugin.
- **Domain** — Pure logic without Express or network I/O (normalization, trigger rules, plugin-local types).
- **Infrastructure** — Outbound adapters: Jira REST clients, GitHub/Bitbucket APIs, ADF conversion, mocks.

## Package layouts

### `@agent-detective/jira-adapter`

| Layer            | Path |
|------------------|------|
| Presentation     | `src/presentation/` |
| Application      | `src/application/` (webhook pipeline, handlers, `options-schema`) |
| Domain           | `src/domain/` (types, normalizer, comment triggers) |
| Infrastructure   | `src/infrastructure/` (Jira clients, markdown→ADF) |

Entry point remains [`src/index.ts`](../packages/jira-adapter/src/index.ts) (plugin registration / composition).

### `@agent-detective/pr-pipeline`

| Layer            | Path |
|------------------|------|
| Application      | `src/application/` (`run-pr-workflow`, `options-schema`) |
| Infrastructure   | `src/infrastructure/` (GitHub, Bitbucket, tokens, Jira stamping helpers) |

Entry point remains [`src/index.ts`](../packages/pr-pipeline/src/index.ts).

### `@agent-detective/local-repos-plugin`

| Layer            | Path |
|------------------|------|
| Presentation     | `src/presentation/` (`repos-controller`) |
| Application      | `src/application/` (`analyzer`, `options-schema`) |
| Domain           | `src/domain/` (`types`, `repo-matcher`, `validate`) |
| Infrastructure   | `src/infrastructure/` (`tech-stack-detector`, `summary-generator`, `repo-context`) |

Entry point remains [`src/index.ts`](../packages/local-repos-plugin/src/index.ts).

## Root app (`src/`)

The host process is the **composition root**: Express server (presentation), plugin system and orchestrator (application / glue), agent CLI adapters (infrastructure). See [ADR 0001](adr/0001-layering-and-plugin-boundaries.md).

## What we avoid

- Generic `utils/` buckets without a layer name.
- Big-bang renames without stabilizing shared types in `@agent-detective/types` first.

For the original design discussion, see the internal planning note **Structure hexagonal fit** (project plans).
