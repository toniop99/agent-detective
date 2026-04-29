---
title: "Installation and deployment paths"
description: Choose how to run agent-detective — native binary, from source, or bare metal.
sidebar:
  order: 1
---

# Installation and deployment paths

Choose how you run agent-detective on a host or in your cluster. This page is the **entry point**; the detailed guides are linked below.

:::tip[Reading order]
Use the **Configuration** section in the sidebar after you pick an install path—load order and env are documented there.
:::

**Typical reading order:** this page (choose how you run) → [golden path](golden-path.md) (first webhook → analysis) → [configuration hub](../config/configuration-hub.md) (how settings load) → [upgrading](upgrading.md) (releases and upgrades).

**Native binary on a single Linux VM:** [binary.md](binary.md) (download, `doctor`, signatures) → [deployment.md](deployment.md) (install layout, systemd, nginx, health checks).

## Choose a deployment style

| Path | When to use | What you need |
|------|-------------|---------------|
| **Native binary (GitHub Releases)** | Single executable on a host (no system Node.js/pnpm); best for bare-metal installs | Download the binary, a `config/` directory, and agent CLIs on `PATH` (use `doctor` to verify) |
| **From source (git + pnpm)** | You fork the repo, change `packages/`, or run from a clone | Node.js 24+, pnpm 10+ (see root [package.json](../../package.json) `packageManager`), git |
| **Bare metal: systemd + reverse proxy** | Production VM: native binary under `/opt`, systemd, then nginx TLS | [deployment.md](deployment.md) (end-to-end binary path, from-source systemd, nginx, sizing) |

:::note[Kubernetes]
This repository does not ship Helm charts. Run the app in your platform’s standard workload (container image you build, or a VM with the native binary / Node) using the same `config/` + env model as in [configuration.md](../config/configuration.md) and [deployment.md](deployment.md).
:::

## Host capabilities

- **Process:** Node.js 24+ when building from source, or a published **native binary** (no system Node).
- **Configuration:** JSON under `config/` ([configuration.md](../config/configuration.md)); optional `config/local.json` (often gitignored) for secrets and overrides.
- **Repositories:** the **local-repos** plugin needs **git** and filesystem access to the repos you list in config (local paths or bind mounts you configure).
- **Network:** outbound to Jira (if you use the Jira plugin), to git remotes (for [pr-pipeline](../config/configuration.md#pr-pipeline-agent-detectivepr-pipeline)), and to your AI provider as required by the agent CLI (e.g. OpenCode). Inbound: HTTP(S) to the app (webhooks, API).
- **Agent CLIs:** the host must be able to run the configured agent (e.g. `opencode`). See [cursor-agent.md](../development/cursor-agent.md) for the Cursor CLI, which is not installed via npm.

## Configuration (all paths)

:::caution
Use `config/local.json` (gitignored) or environment variables for secrets. Never commit API tokens or credentials to `config/default.json`.
:::

1. Read the **[configuration hub](../config/configuration-hub.md)** for load order and top-level `config` shape.
2. Use [configuration.md](../config/configuration.md) for the full env whitelist and plugin narratives.
3. Use `config/local.json` and/or the **env whitelist** for secrets in production.
4. For plugin option fields, use [generated/plugin-options.md](../reference/generated/plugin-options.md).

## Detailed guides

| Topic | Document |
|-------|----------|
| Native binary (GitHub Releases) | [binary.md](binary.md) |
| Bare metal: binary → systemd → nginx, health checks, troubleshooting | [deployment.md](deployment.md) |
| Config files, env, plugins | [configuration.md](../config/configuration.md) |
| Releases, git upgrade, binary refresh | [upgrading.md](upgrading.md) |
| Maintainer: tag and release | [releasing.md](releasing.md) |
| Jira E2E (tunnel, webhooks, pr-pipeline) | [e2e/README.md](../e2e/README.md) |
| Day-to-day monorepo development | [development.md](../development/development.md) |

## Clone URL (from source)

If you build from a clone, use the upstream repository (or your fork’s URL):

```bash title="Clone from GitHub"
git clone https://github.com/toniop99/agent-detective.git
cd agent-detective
```

Replace `toniop99/agent-detective` with your fork’s `owner/name` on GitHub if applicable.

## See also

- [configuration-hub.md](../config/configuration-hub.md) — config load order and top-level keys
- [upgrading.md](upgrading.md) — releases and upgrade runbook
- Root [README.md](../../README.md) — quick start
- [extending-with-plugins.md](../plugins/extending-with-plugins.md) — npm, path, or `plugins/` directory for custom plugins
- [publishing.md](../plugins/publishing.md) — publishing `@agent-detective/*` packages (maintainers)
- Release notes live in GitHub Releases; see `docs/operator/upgrading.md`.
