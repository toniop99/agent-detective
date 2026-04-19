# Docker

Run **agent-detective** in containers for local development or production-style deployment on a single host.

## Requirements

- Docker Engine 24+ with BuildKit (default on Docker Desktop)
- Optional: Docker Compose v2

## Image targets (`Dockerfile`)

| Target | Purpose |
|--------|---------|
| **`dev`** (default) | Installs the monorepo with pnpm; use with **bind mounts** for `src/` and `packages/` so `pnpm dev` hot-reloads. |
| **`production`** | Builds workspace packages, bundles the app with **tsup**, prunes devDependencies, runs **`node dist/index.js`**. Optional CLI agents (opencode, claude, gemini) via build-arg **`AGENTS`**. |

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

Environment variables (see also [configuration.md](configuration.md) and `config/default.json`):

| Variable | Description |
|----------|-------------|
| `PORT` | Host port mapped to container `3001` (default `3001`) |
| `IMAGE_NAME` | Image name/tag (default `agent-detective:latest`) |
| `AGENTS` | Build-arg when building: comma-separated agents to `npm install -g` in the image |
| `AGENT` | Default agent id (e.g. `opencode`) |
| `MODEL` | Default model for the selected agent |
| `LOG_LEVEL` | Aliased to `OBSERVABILITY_LOG_LEVEL` when the latter is unset (`debug` \| `info` \| `warn` \| `error`) |
| `AGENTS_*_MODEL` | Model overrides per agent |
| `REPO_CONTEXT_GIT_LOG_MAX_COMMITS` | Merged into local-repos plugin `repoContext.gitLogMaxCommits` when that plugin is listed in config |
| `JIRA_*` | Jira adapter credentials when that plugin is listed in config (`JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_BASE_URL`) |

**Jira secrets:** pass `JIRA_API_TOKEN`, `JIRA_EMAIL`, and `JIRA_BASE_URL` in the environment (`.env` next to compose, CI variables, or your orchestrator). This repository’s compose file does **not** require Docker Swarm-style secret files.

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

## Verifying the image locally

With Docker installed:

```bash
docker build --target production -t agent-detective:local .
docker run --rm -p 3001:3001 -v "$(pwd)/config:/app/config:ro" agent-detective:local
# In another terminal:
wget -qO- http://127.0.0.1:3001/api/health
```

## Troubleshooting

- **Plugins not loading in the image:** Ensure `config/*.json` lists plugins that exist in the image (`node_modules` or mounted `./packages`). Built plugins are loaded from **`packages/<name>/dist/index.js`** when the bare package import is unavailable.
- **`pnpm install` fails in Docker:** The dev and builder stages use **`pnpm@8.15.9`** via Corepack to match `package.json` / lockfile.
- **Permission errors on mounted volumes (Linux):** Adjust host directory ownership or run dev compose with a user override matching your UID.
