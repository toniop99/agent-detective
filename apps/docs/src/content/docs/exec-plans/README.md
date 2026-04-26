---
title: "Execution plans"
---

# Execution plans

Versioned **intent, steps, and acceptance criteria** for multi-step or cross-cutting work so agents (and humans) are not limited to chat history.

## When to add a plan

Use **`active/`** when work spans multiple PRs, packages, or needs explicit checkboxes (config schema, plugin boundaries, migrations). Skip for one-file typo fixes.

## Layout

| Path | Use |
|------|-----|
| [`active/`](https://github.com/toniop99/agent-detective/blob/main/docs/exec-plans/active) | Current work — one markdown file per initiative (`YYYY-mm-topic.md` or similar). |
| [`completed/`](https://github.com/toniop99/agent-detective/blob/main/docs/exec-plans/completed) | Done plans — move here when merged or abandoned (short note if abandoned). |

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

- [Agent harness](/docs/development/agent-harness/) — verify commands.
- [ADR index](https://github.com/toniop99/agent-detective/blob/main/docs/architecture/adr) — behavior-changing decisions.
