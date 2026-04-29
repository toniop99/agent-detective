---
name: agent-detective-verify
description: >-
  Runs or delegates Agent Detective CI-style verification (build, typecheck, lint,
  test, docs config/plugins). Use after substantive edits, before PR, or when CI
  failed locally. Prefer delegating to the agent-detective-verify subagent
  (.agents/agents/ canonical; .cursor/agents/ after pnpm install or agents:sync-cursor).
---

# Agent Detective — verify harness

## When to use

- After changing TypeScript, plugins, root `src/`, or workspace `packages/*`.
- After editing Zod config schema or plugin options (also run docs generation checks).
- User asks whether the repo is green or what failed in CI.

## What to do

1. Read `docs/development/agent-harness.mdx` if you need smoke, server, or PORT details.
2. Prefer invoking the **`agent-detective-verify`** custom subagent so verification runs in a focused context. Definitions live in **`.agents/agents/agent-detective-verify.md`**; **`.cursor/agents/`** is a symlink to that folder (created by `pnpm install` or **`pnpm run agents:sync-cursor`**).
3. If staying in-session: run the Quick verify block from that agent file; pass **changed package names** so Turbo filters can shorten the loop.

## Do not

- Skip `pnpm run lint` when plugin imports or boundaries may have changed (import guard script).
- Forget `pnpm docs:config` / `pnpm docs:plugins` (or `:check`) after schema or plugin option edits.
