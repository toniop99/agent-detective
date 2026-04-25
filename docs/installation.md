# Installation and deployment paths

Choose how you run agent-detective on a host or in your cluster. This page is the **entry point**; the detailed guides are linked below.

**Typical reading order:** this page (choose how you run) → [configuration hub](configuration-hub.md) (how settings load) → [upgrading](upgrading.md) (releases and image tags).

## Choose a deployment style

| Path | When to use | What you need |
|------|-------------|---------------|
| **Container image (GHCR)** | Production on a single host or small team; minimal build steps | Docker (or compatible runtime), a `config/` directory to mount, secrets via env (see [configuration.md](configuration.md)) |
| **Docker Compose (build or pull)** | Same as above, but you want `compose` and optional bind mounts for `config/` and `plugins/` | [docker.md](docker.md) (includes [docker-compose.ghcr.yml](../docker-compose.ghcr.yml) for pull-only) |
| **From source (git + pnpm)** | You fork the repo, change `packages/`, or run without a prebuilt image | Node.js 24+, pnpm 10+ (see root [package.json](../package.json) `packageManager`), git |
| **Bare metal: systemd + reverse proxy** | No Docker; long-running service on a VM with nginx or similar | [deployment.md](deployment.md) (systemd, nginx, sizing) |

**Kubernetes or Helm:** this repository does not ship charts. Run the [GHCR image](docker.md#published-image-ghcr) with your platform’s standard workload manifest and the same `config` + env model as in [docker.md](docker.md).

## Host capabilities

- **Process:** either the container image (includes a bundled `node` + built app) or Node.js 24+ when building from source.
- **Configuration:** JSON under `config/` ([configuration.md](configuration.md)); optional `config/local.json` (often gitignored) for secrets and overrides.
- **Repositories:** the **local-repos** plugin needs **git** and filesystem access to the repos you list in config (bind mounts in Docker, or local paths on bare metal).
- **Network:** outbound to Jira (if you use the Jira plugin), to git remotes (for [pr-pipeline](configuration.md#pr-pipeline-agent-detectivepr-pipeline)), and to your AI provider as required by the agent CLI (e.g. OpenCode). Inbound: HTTP(S) to the app (webhooks, API).
- **Agent CLIs:** the image or host must be able to run the configured agent (e.g. `opencode` in the default image). See [docker.md](docker.md#image-targets-dockerfile) and [cursor-agent.md](cursor-agent.md) for adding other agents.

## Configuration (all paths)

1. Read the **[configuration hub](configuration-hub.md)** for load order and top-level `config` shape.
2. Use [configuration.md](configuration.md) for the full env whitelist and plugin narratives.
3. Use `config/local.json` and/or the **env whitelist** for secrets in production.
4. For plugin option fields, use [generated/plugin-options.md](generated/plugin-options.md).

## Detailed guides

| Topic | Document |
|-------|----------|
| Docker, Compose, production image, GHCR | [docker.md](docker.md) |
| systemd, nginx, health checks, troubleshooting (no Docker) | [deployment.md](deployment.md) |
| Config files, env, plugins | [configuration.md](configuration.md) |
| Releases, pinning images, git upgrade | [upgrading.md](upgrading.md) |
| Day-to-day monorepo development | [development.md](development.md) |

## Clone URL (from source)

If you build from a clone, use the upstream repository (or your fork’s URL):

```bash
git clone https://github.com/toniop99/agent-detective.git
cd agent-detective
```

Replace `toniop99/agent-detective` with your fork’s `owner/name` on GitHub if applicable.

## See also

- [configuration-hub.md](configuration-hub.md) — config load order and top-level keys
- [upgrading.md](upgrading.md) — image tags, releases, and upgrade runbook
- Root [README.md](../README.md) — quick start and GHCR one-liner
- [publishing.md](publishing.md) — building and publishing the image (maintainers)
- [CHANGELOG.md](CHANGELOG.md) — breaking config and behavior notes
