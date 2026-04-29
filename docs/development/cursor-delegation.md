---
title: Cursor delegation (subagents and skills)
description: How to delegate work to project subagents and skills in this repo.
sidebar:
  order: 7
---

# Cursor delegation (subagents and skills)

Canonical **subagent** and **skill** definitions live under **[`.agents/`](../../.agents/README.md)** (`agents/*.md`, `skills/<name>/SKILL.md`) so OpenCode, Claude Code, or any runner can load the same files without Cursor-specific paths.

## Cursor mirror (symlinks)

Cursor only reads **`.cursor/agents/`** and **`.cursor/skills/`**. Those paths are **symlinks** to **`.agents/agents/`** and **`.agents/skills/`**, created by **`postinstall`** / **`pnpm run agents:sync-cursor`**, and are **gitignored**:

```bash
pnpm run agents:sync-cursor
```

Edit files only under **`.agents/`**; Cursor sees the same content through `.cursor/`. Re-run the command if someone replaced the symlinks with a copied directory.

Subagents and skills for this project **stay in the repo** (`.agents/` plus local `.cursor/` links); they are not installed to a global home directory.

On **Windows** (outside WSL), creating directory symlinks may require Developer Mode or an elevated shell; use WSL or enable symlinks if `postinstall` fails with `EPERM`.

## Subagents (`.agents/agents/*.md`)

Each file is YAML frontmatter plus a body used as a focused system prompt when delegated.

**Cursor frontmatter (optional, product-specific):** besides `name` and `description`, these agents set:

| Field | Meaning |
|-------|--------|
| `readonly` | `true` = analysis-only (no writes / restricted tools). `false` = may run shell (e.g. `pnpm test`) or edit files. |
| `is_background` | `true` = subagent may return without blocking the parent UI. Here all are `false` so the parent usually waits on the result (verify output, audit list, etc.). |

**This repo:** `readonly: true` on **repo-cartographer** and **plugin-boundary-auditor**; `readonly: false` on **agent-detective-verify** (must run the harness), **package-implementer**, **docs-starlight-sync**, and **integration-smoke**. If a Cursor build misbehaves with `readonly: true` (known forum reports), try toggling it off for that agent.

| File | Role |
|------|------|
| `repo-cartographer.md` | Map packages and docs entry points; no large dumps. |
| `plugin-boundary-auditor.md` | ADR 0001 + golden rules + import-guard alignment. |
| `agent-detective-verify.md` | Build / typecheck / lint / test (+ docs checks when relevant). |
| `package-implementer.md` | Single-tree implementation with explicit acceptance criteria. |
| `docs-starlight-sync.md` | `docs/` vs Starlight sync vs hand `index.mdx`. |
| `integration-smoke.md` | Adapters, webhooks, E2E/smoke and PORT notes. |

**Parent contract:** pass only what that agent needs (goal, package list, exec-plan excerpt). **Child contract:** return summaries, violation lists, or failure tails—not full logs or whole files.

## Skills (`.agents/skills/*/SKILL.md`)

Skills tell the **main** agent when to apply a workflow or delegate:

| Skill | Use |
|-------|-----|
| `agent-detective-verify` | After edits; points at harness + verify subagent. |
| `agent-detective-plugin-author` | Plugin authoring; points at ADR 0001 + auditor/implementer. |
| `agent-detective-docs-sync` | Doc and Starlight workflow; points at docs subagent. |

## Related

- [Agent harness](./agent-harness.mdx) · [Agent workflow](./agent-workflow.md) · [Golden rules](./agent-golden-rules.md)
- Root index: [AGENTS.md](../../AGENTS.md) · [.agents/README.md](../../.agents/README.md)
