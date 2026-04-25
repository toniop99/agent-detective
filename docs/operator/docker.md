# Docker

Run **agent-detective** in containers for local development or production-style deployment on a single host. For a comparison with bare-metal and from-source installs, see [installation.md](installation.md).

## Requirements

- Docker Engine 24+ with BuildKit (default on Docker Desktop)
- Optional: Docker Compose v2

The image copies **`pnpm-workspace.yaml`** (workspace is **`packages/*`** plus the root app), **`pnpm-lock.yaml`**, and runs **`pnpm install --frozen-lockfile`** so the lockfile in git must match the Docker build context.

## Image targets (`Dockerfile`)

| Target | Purpose |
|--------|---------|
| **`dev`** (default) | Installs the monorepo with pnpm; use with **bind mounts** for `src/` and `packages/` so `pnpm dev` hot-reloads. |
| **`production`** | Builds workspace packages, bundles the app with **tsup**, prunes devDependencies, runs **`node dist/index.js`**. Optional CLI agents via build-arg **`AGENTS`**: **`opencode`** from **`opencode-ai`** ([OpenCode docs](https://opencode.ai/docs)), **`claude`** from [**`@anthropic-ai/claude-code`**](https://www.npmjs.com/package/@anthropic-ai/claude-code). The **Cursor Agent CLI** (`agent` on `PATH`) is not installed in the default image — use the [official install script](https://cursor.com/docs/cli/installation) on the host or extend the image (see [cursor-agent.md](../development/cursor-agent.md)). |

### Health checks

The HTTP API is mounted under **`/api`**. Health is:

- **`GET /api/health`** — JSON body includes `"status"` (`ok` \| `degraded` \| `unhealthy`).

Compose and the production image healthcheck use this path (not `/health`).

## Local development

From the repository root:

```bash
docker compose build
docker compose up
```

This uses **`docker-compose.yml`**, target **`dev`**, and mounts `./src`, `./packages`, and `./config` into the container. The app listens on **port 3001**.

- **CLI agents** (OpenCode, Claude, etc.) are typically installed on the **host** and invoked from the container only if their binaries are on `PATH` inside the image. For a fully self-contained dev image, extend the Dockerfile or install agents in a custom image.

### Rebuild after dependency changes

```bash
docker compose build --no-cache
```

## Production-style run (single host)

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Environment variables (see also [configuration.md](../config/configuration.md) and `config/default.json`):

| Variable | Description |
|----------|-------------|
| `PORT` | Host port mapped to container `3001` (default `3001`) |
| `IMAGE_NAME` | Image name/tag (default `agent-detective:latest`) |
| `AGENTS` | Build-arg when building: comma-separated agents to `npm install -g` in the image |
| `AGENT` | Default agent id (e.g. `opencode`) |
| `LOG_LEVEL` | Aliased to `OBSERVABILITY_LOG_LEVEL` when the latter is unset (`debug` \| `info` \| `warn` \| `error`) |
| `AGENTS_*_MODEL` | Model overrides per agent (see [configuration.md](../config/configuration.md)) |
| `AGENTS_RUNNER_*`, `OBSERVABILITY_REQUEST_LOGGER_EXCLUDE_PATHS` | See [configuration.md](../config/configuration.md#core-env-whitelist) |
| `REPO_CONTEXT_*`, `SUMMARY_MAX_OUTPUT_CHARS`, `JIRA_*` | As in [configuration.md](../config/configuration.md#plugin-env-whitelist-first-party) |
| `JIRA_API_TOKEN` / `JIRA_EMAIL` / `JIRA_BASE_URL` | Jira adapter when that plugin is listed in config |

**Jira secrets:** pass `JIRA_API_TOKEN`, `JIRA_EMAIL`, and `JIRA_BASE_URL` in the environment (`.env` next to compose, CI variables, or your orchestrator). This repository’s compose file does **not** require Docker Swarm-style secret files.

**TLS in front of the app:** The nginx `server` / `proxy_pass` **example** (long timeouts, headers for the API) lives in a single place: [deployment.md#reverse-proxy-nginx](deployment.md#reverse-proxy-nginx) — set `proxy_pass` to the host port that maps to the container’s `3001` (or your `PORT`).

### Build production image only

```bash
docker build --target production --build-arg AGENTS=opencode,claude -t agent-detective:latest .
docker run --rm -p 3001:3001 -v "$(pwd)/config:/app/config:ro" agent-detective:latest
```

The process **`cwd`** must be the app root (`WORKDIR /app` in the image) so workspace plugins resolve under `packages/`.

## GitHub Actions

| Workflow | When | What |
|----------|------|------|
| **`ci.yml`** | PR and push to `main` | Lint, typecheck, test, build (Turbo). |
| **`docker.yml`** | PR and push to `main` | Runs the same checks, then builds the **`production`** image. **Pushes to GHCR only on push to `main`**; on PRs the image is built and **loaded locally** on the runner for a smoke test (no registry push). |
| **`release.yml`** | Tag `v*.*.*` | CI, multi-arch push to GHCR, Trivy scan, GitHub Release. |

Image: **`ghcr.io/<owner>/<repo>`** (repository name lowercased by the registry).

## Published image (GHCR)

Images are published to **`ghcr.io/<owner>/<repo>`** (for this upstream repo: **`ghcr.io/toniop99/agent-detective`**). Pushes to **`main`** produce **`latest`** (multi-arch **linux/amd64** and **linux/arm64**) with **`AGENTS=opencode`** baked in. Version tags (for example **`stable`**, **`1.x.x`**) come from the release workflow and may include additional CLIs; see [.github/workflows/release.yml](../../.github/workflows/release.yml).

### Pull and run (Docker CLI)

```bash
docker pull ghcr.io/toniop99/agent-detective:latest
docker run -d --name agent-detective -p 3001:3001 \
  -v "$(pwd)/config:/app/config:ro" \
  -e NODE_ENV=production \
  ghcr.io/toniop99/agent-detective:latest
```

Optional: mount custom plugins and pass Jira or model overrides (same variables as [docker-compose.prod.yml](../../docker-compose.prod.yml)).

### Pull and run (Compose, no build)

From a directory that contains **`config/`** (copy [`config/default.json`](../../config/default.json) from the repo or your own files) and optionally **`plugins/`**:

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

Override the image (for example a fork or a release tag):

```bash
export GHCR_IMAGE=ghcr.io/toniop99/agent-detective:stable
docker compose -f docker-compose.ghcr.yml up -d
```

### OpenCode providers and secrets

agent-detective shells out to **`opencode`**; it does not store provider API keys in `config/default.json`. Pass the environment variables your provider needs via **`docker run -e`** / Compose **`environment`**, or follow [OpenCode configuration](https://opencode.ai/docs) for interactive setup (for example OpenCode Zen). The Node process inherits the container environment, so those variables reach the CLI.

### Quick verification

```bash
docker run --rm ghcr.io/toniop99/agent-detective:latest bash -lc 'command -v opencode && opencode --version'
wget -qO- http://127.0.0.1:3001/api/health
wget -qO- http://127.0.0.1:3001/api/agent/list
```

Expect **`opencode`** in the agent list with **`available": true`** after a successful install.

## Verifying the image locally

With Docker installed:

```bash
docker build --target production -t agent-detective:local .
docker run --rm -p 3001:3001 -v "$(pwd)/config:/app/config:ro" agent-detective:local
# In another terminal:
wget -qO- http://127.0.0.1:3001/api/health
```

## See also

- [installation.md](installation.md) · [configuration-hub.md](../config/configuration-hub.md) · [upgrading.md](upgrading.md)
- [deployment.md](deployment.md) — bare metal, systemd, and the **single** [nginx](deployment.md#reverse-proxy-nginx) example referenced above

## Troubleshooting

- **Plugins not loading in the image:** Ensure `config/*.json` lists plugins that exist in the image (`node_modules` or mounted `./packages`). Built plugins are loaded from **`packages/<name>/dist/index.js`** when the bare package import is unavailable.
- **`pnpm install` fails in Docker:** The dev and builder stages use the **same pnpm major** as `package.json` `packageManager` via Corepack; keep them in sync when upgrading.
- **Permission errors on mounted volumes (Linux):** Adjust host directory ownership or run dev compose with a user override matching your UID.
