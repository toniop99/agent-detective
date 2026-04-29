---
title: "Agent workflow (suggested loop)"
description: Recommended coding loop for agents — plan, implement, verify, and open a PR.
sidebar:
  order: 3
---

# Agent workflow (suggested loop)

This repo is **human-steered**; automation and docs exist so agents can ship safely without relying on chat-only context.

## Before coding

:::note[Before you start]

1. Read the task and [Agent golden rules](./agent-golden-rules.md).
2. For large work, add or update a file under **`docs/exec-plans/active/`** (see **`docs/exec-plans/README.md`** when that folder exists in the repo).

:::

## While coding

:::tip[Keep it consistent]

1. Match existing patterns in the touched package (`packages/*` or root `src/`).
2. Shared contracts belong in **`@agent-detective/types`** — not compile-time imports between plugins ([ADR 0001](../architecture/adr/0001-layering-and-plugin-boundaries.md)).

:::

## Before opening a PR

:::caution[Do not skip these checks]

1. Run the [Agent harness](./agent-harness.md) **Quick verify** block (`build`, `typecheck`, `lint`, `test`).
2. After schema or plugin option edits, run `docs:config` / `docs:plugins` (or their `:check` variants).
3. Self-review the diff (behavior, edge cases, tests).

:::

## Review expectations

Pull requests are expected to pass CI and stay within the task scope. **Human review** is normal for this project unless maintainers explicitly say otherwise.

## Related

- [Agent harness](./agent-harness.md) · [References](../references/README.md)
