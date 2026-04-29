---
name: agent-detective-docs-sync
description: >-
  Handles Agent Detective documentation workflow: docs/ source, Starlight sync to
  apps/docs, hand-edited index.mdx, and generated config/plugin docs. Use when
  editing docs/**/*.md, apps/docs content, or after schema-driven doc regen.
  Prefer delegating to docs-starlight-sync subagent.
---

# Agent Detective — docs and Starlight sync

## When to use

- Editing `docs/**/*.md` or operator/developer prose.
- Touching `apps/docs/` or landing-related doc merges.
- After changes to `src/config/schema.ts` or plugin Zod options that feed generated docs.

## Actions

1. Confirm whether the file is **source** (`docs/`), **synced** (`apps/docs/src/content/docs/` from `pnpm run docs:site:sync`), or **hand-only** (`apps/docs/src/content/docs/index.mdx`).
2. Prefer delegating to the **`docs-starlight-sync`** subagent (definitions in **`.agents/agents/docs-starlight-sync.md`**; Cursor mirror under **`.cursor/agents/`** after sync).
3. After schema/plugin option edits: run or request `pnpm docs:config` and `pnpm docs:plugins` (or `:check`).

## Index

- `AGENTS.md` (Starlight one-liner + commands)
- `apps/docs/README.md` for site/landing merge behavior
