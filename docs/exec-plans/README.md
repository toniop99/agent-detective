---
title: Execution plans
description: Index and template for versioned multi-step execution plans and initiatives.
sidebar:
  order: 1
---

# Execution plans

Versioned **intent, steps, and acceptance criteria** for multi-step or cross-cutting work so agents (and humans) are not limited to chat history.

## When to add a plan

Use **`active/`** when work spans multiple PRs, packages, or needs explicit checkboxes (config schema, plugin boundaries, migrations). Skip for one-file typo fixes.

## Layout

| Path | Use |
|------|-----|
| [`active/`](./active/) | Current work — one markdown file per initiative (`YYYY-mm-topic.md` or similar). Example: [`active/2026-04-linear-adapter.md`](./active/2026-04-linear-adapter.md). |
| [`completed/`](./completed/) | Done plans — move here when merged or abandoned (short note if abandoned). |

## Template (copy into a new file)

```markdown
# Title

## Goal
One paragraph.

## Acceptance criteria
- [ ] …

## Notes / decisions
- …
```

## Related

- [Agent harness](../development/agent-harness.md) — verify commands.
- [ADR index](../architecture/adr/) — behavior-changing decisions.
