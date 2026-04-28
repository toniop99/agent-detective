---
title: "ADR 0001: Layering, plugin boundaries, and monolith-first composition"
description: Architecture decision record for layering, plugin boundaries, and monolith-first design.
sidebar:
  order: 3
---

# ADR 0001: Layering, plugin boundaries, and monolith-first composition

## Status

Accepted

## Context

Agent Detective is a **self-hosted integration hub**: webhooks and plugins normalize work into `TaskEvent`s, use local repository context, and optionally drive PR workflows. The codebase is a **pnpm monorepo** with a root Fastify app and workspace packages (`jira-adapter`, `local-repos-plugin`, `pr-pipeline`, etc.).

We want:

- Clear **ingress vs workflow vs outbound integrations** over time (multiple issue trackers, same PR engine).
- Familiar structure for contributors used to **hexagonal**, **onion**, or **layered** architectures in private repos—without adopting heavy DDD ceremony.

## Decision

1. **Monolith-first** — One process, explicit plugin loading ([`createPluginSystem`](../../../src/core/plugin-system.ts)). No microservices unless multi-tenant hosting demands it later.

2. **Ports in `@agent-detective/types`** — Shared contracts stay in the types package; plugins implement or consume them via the service registry. Avoid compile-time imports from another plugin package for **interfaces** (prefer types + `getService`).

3. **Per-package layering** — Inside each plugin package we use four logical layers where it helps:
   - **presentation** — HTTP routes (Fastify scopes + `defineRoute()` from `@agent-detective/sdk`)
   - **application** — use cases, handler orchestration, plugin Zod options
   - **domain** — pure transforms and plugin-local domain types (no I/O)
   - **infrastructure** — external systems (Jira REST, Git host APIs, mocks)

   Concrete folder layout is documented in [architecture-layering.md](../architecture-layering.md).

4. **Hexagonal mental model** — Driving adapters (webhooks) call application code; application code depends on **ports** (types + `AgentRunner` + registered services); driven adapters (Jira client, GitHub PR) live in infrastructure.

## Consequences

- **Positive:** Easier navigation, clearer place for new adapters, aligns with future “second ingress” work (Linear, GitHub Issues) without a single flat `src/` dump.
- **Negative:** Deeper paths and import churn when refactoring; mitigated by doing one package at a time and keeping entry `index.ts` thin.

## References

- [architecture-layering.md](../architecture-layering.md)
- [architecture.md](../architecture.md) (high-level component view)
