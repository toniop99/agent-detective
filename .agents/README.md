# Shared agent definitions (tool-agnostic)

This folder is the **canonical** store for:

- **`agents/*.md`** — subagent-style prompts (YAML `name` + `description` + markdown body). Use from OpenCode, Claude Code, or any runner that can load markdown system prompts.
- **`skills/<id>/SKILL.md`** — Cursor-style skills (YAML frontmatter + instructions). Same portability: copy or symlink into another tool’s skill dir if supported.

**Local-only plans** stay under `.agents/plans/` (gitignored). See `docs/development/plan-conventions.md`.

## Cursor

Subagent YAML may include **`readonly`** and **`is_background`** (see `docs/development/cursor-delegation.md`). Required fields remain **`name`** and **`description`**.

Cursor reads **`.cursor/agents/`** and **`.cursor/skills/`** only. After `pnpm install`, **`postinstall`** runs `scripts/sync-cursor-from-agents.mjs` to create **symlinks** from `.cursor/agents` → `.agents/agents` and `.cursor/skills` → `.agents/skills`. To fix or recreate links manually:

```bash
pnpm run agents:sync-cursor
```

Those `.cursor/…` entries are gitignored. Edit files under **`.agents/`** only.

## Docs

[`docs/development/cursor-delegation.md`](../docs/development/cursor-delegation.md) · [`AGENTS.md`](../AGENTS.md)
