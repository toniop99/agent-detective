---
title: "ADR 0003: SQLite persistence, host-provided services, and Jira spawn idempotency"
description: Architecture decision record for host-owned SQLite (node:sqlite), synthetic host plugin services, and optional Jira subtask spawning.
sidebar:
  order: 5
---

# ADR 0003: SQLite persistence, host-provided services, and Jira spawn idempotency

## Status

Accepted

## Context

The product needs a **first-class persistence layer** in the host for idempotency (e.g. Jira operations), future session state, and related features. Plugins must not import root `src/` (see [ADR 0001](./0001-layering-and-plugin-boundaries.md)). Today only **plugins** register services via `PluginContext.registerService`; there is no first-class way for the **host** to expose services to plugins through the same registry.

Release artifacts are **Node single executable applications (SEA)** with **no `node_modules`**. Native npm drivers such as `better-sqlite3` ship **`.node`** binaries that do not bundle into the SEA JavaScript blob the way pure JS does.

Operator decisions already locked (see `.agents/plans/2026_04_30-sqlite-persistence-and-jira-spawned-issues/`):

- **Driver:** `node:sqlite` (built into the Node binary used for SEA and from-source runs on supported versions).
- **Migrations:** versioned SQL steps bundled in the host runner (SEA-safe, no loose `.sql` on disk), `schema_migrations` table — **no** dedicated migration npm package.
- **Jira v1:** **subtasks** under the parent issue; **templates + optional agent JSON** for fields; **max 3** spawns per `TASK_COMPLETED` by default (configurable).
- **Config:** when persistence is **enabled**, **`databasePath` is required** (no implicit default file).
- **Run records:** keep existing JSONL run records in v1; SQLite is orthogonal unless merged later.

## Decision

1. **Port in `@agent-detective/types`** — Define `AppPersistence`, `AppPersistenceTxn`, and Jira dedupe row types. No `node:sqlite` import in the types package (type-only).

2. **Constants in `@agent-detective/sdk`** — `HOST_PERSISTENCE_SERVICE` (registry **service key**) and `HOST_PROVIDER_PLUGIN_NAME` (synthetic **provider plugin name** `'@agent-detective/host'`). Plugins that need the host DB use `getServiceFromPlugin(HOST_PERSISTENCE_SERVICE, HOST_PROVIDER_PLUGIN_NAME)` inside try/catch when persistence is optional.

3. **Implementation in root `src/persistence/`** — Host opens SQLite, runs migrations, implements `AppPersistence`. **No** SQLite npm dependency for the default path.

4. **Host registration (Phase 3)** — Before normal plugins `register()`, the host seeds services with `registerServiceForPlugin(HOST_PROVIDER_PLUGIN_NAME, HOST_PERSISTENCE_SERVICE, impl)` (or equivalent internal API). Because `getServiceFromPlugin` requires the provider to appear **loaded/active** in [`plugin-system.ts`](../../../src/core/plugin-system.ts), the host **must** either:
   - insert a **synthetic** `LoadedPlugin` entry for `HOST_PROVIDER_PLUGIN_NAME`, or
   - extend the plugin system to treat `HOST_PROVIDER_PLUGIN_NAME` as always eligible for service lookup,
   
   documented and implemented in the same Phase 3 change as persistence wiring.

5. **Jira adapter (Phase 4)** — Opt-in spawn after `TASK_COMPLETED`; idempotency via `AppPersistenceTxn` inside `withTransaction` before REST calls; respect `mockMode` (no REST; still record dedupe as decided in plugin options / follow-up ADR prose).

## Consequences

- **Positive:** One persistence story for monolith, Docker, and SEA; aligns with pinned **Node 25** release builds; clear ADR for plugin authors.
- **Positive:** Optional persistence: consumers guard `getServiceFromPlugin` failures when the host disables persistence or omits the synthetic provider.
- **Negative:** `node:sqlite` stability and **minimum Node version** when persistence is enabled must be documented for operators (RC / engine matrix evolves).
- **Negative:** Synthetic host provider adds a special case in the plugin system until generalized.

## Non-goals (v1)

- Replacing run-records JSONL with SQLite.
- Multi-writer SQLite across processes without explicit ops guidance (document single-writer; NFS/WAL caveats in operator docs).
- Jira **issue link** modes (e.g. “Relates to”) in v1 — subtasks only unless a later phase extends options.

## References

- [ADR 0001 — layering and plugin boundaries](./0001-layering-and-plugin-boundaries.md)
- [Node.js SQLite](https://nodejs.org/api/sqlite.html)
- [Single executable applications](https://nodejs.org/api/single-executable-applications.html)
- Plan: `.agents/plans/2026_04_30-sqlite-persistence-and-jira-spawned-issues/2026_04_30-sqlite-persistence-and-jira-spawned-issues-plan.md`
