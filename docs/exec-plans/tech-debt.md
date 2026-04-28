---
title: Technical debt
description: Rolling notes on known rough edges, patterns to fix, and recently resolved items.
sidebar:
  order: 2
---

# Technical debt (rolling notes)

Short, **repo-local** reminders for patterns to fix or revisit. Prefer [ADR](../architecture/adr/) for decisions; use this for “known rough edges” agents should not amplify.

- *(Add items as one line each; remove when resolved.)*

## Resolved (recent)

- **Plugin SDK package split** — `@agent-detective/core` renamed to `@agent-detective/sdk`; HTTP type declarations moved into `@agent-detective/types`; host-only `applyTagGroups` and tag constants moved into `src/core/openapi/`. Plan: [`completed/2026-04-plugin-sdk-package.md`](completed/2026-04-plugin-sdk-package.md).
