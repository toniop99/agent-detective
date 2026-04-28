---
title: "Cursor Agent CLI"
description: Install, configure, and run the Cursor Agent CLI for background coding tasks.
sidebar:
  order: 5
---

# Cursor Agent CLI

The in-app agent id is **`cursor`**. It runs the [Cursor Agent CLI](https://cursor.com/docs/cli/overview), whose binary is **`agent`** on your `PATH` (not to be confused with this project’s `agent` config key in JSON — that is the *default* agent *id*).

## Install

```bash
# macOS, Linux, WSL
curl https://cursor.com/install -fsS | bash
```

```powershell
# Windows PowerShell
irm 'https://cursor.com/install?win32=true' | iex
```

See [CLI installation](https://cursor.com/docs/cli/installation) for details. The CLI is **not** published on npm; the production Docker image only pre-installs **opencode** and **claude** via `npm install -g`. For containers, install the Cursor CLI in a custom image layer or on the host.

## Configure agent-detective

In `config/default.json` (or `local.json`):

```json
{
  "agent": "cursor",
  "agents": {
    "cursor": {
      "defaultModel": "gpt-5.2"
    }
  }
}
```

Or set **`AGENT=cursor`** and optional **`AGENTS_CURSOR_MODEL=...`** (see [configuration.md](../config/configuration.md)).

## Behavior

- Non-interactive runs use print mode: `-p`, [`--output-format json`](https://cursor.com/docs/cli/reference/output-format), and `--model`.
- **`readOnly`:** when the runner passes `readOnly: true` (e.g. Jira analysis), the adapter adds **`--mode=ask`** ([modes](https://cursor.com/docs/cli/overview)).
- **Session resume:** when `threadId` is set on the run (task context, `POST /api/core/events`, or `options.threadId` on `POST /api/core/agent/run`), the adapter adds **`--resume=<id>`** ([sessions](https://cursor.com/docs/cli/overview)).

## Credentials

Auth for the CLI (login, API keys, etc.) is handled by the Cursor tool and environment; see the official docs. The Node app does not store Cursor credentials in config JSON.

## Parity (opencode, claude, cursor)

| Feature | opencode | claude | cursor |
|--------|----------|--------|--------|
| Default model in config | `agents.opencode.defaultModel` | `agents.claude.defaultModel` | `agents.cursor.defaultModel` |
| `readOnly` in runner | `OPENCODE_PERMISSION` deny list | not mapped | `--mode=ask` |
| `threadId` / resume | `--continue` + `--session` | `--resume` (UUID) | `--resume` |
| Subprocess | no PTY | PTY | no PTY |
| Concurrency | `singleInstance: true` | normal | normal |

`threadId` is passed from [`RunAgentOptions`](../../packages/types/src/index.ts) through the agent runner into each adapter’s `buildCommand`.
