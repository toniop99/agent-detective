# Staying up to date

Use this page when you deploy from a **released image**, track **main** in git, or consume **published npm packages** from this monorepo. It ties together [CHANGELOG.md](CHANGELOG.md), [migration.md](migration.md), and the container registry.

## How to learn about changes

| Channel | Use for |
|---------|---------|
| **[CHANGELOG.md](CHANGELOG.md)** | Breaking or notable config and API changes in the repo |
| **[migration.md](migration.md)** | Short archive of config moves and conventions (not a full version history) |
| **GitHub Releases** | Created when a **`v*.*.*`** tag is pushed; includes image pull commands (see [.github/workflows/release.yml](../.github/workflows/release.yml)) |
| **Watching the repository** | Notifications for releases, discussions, or commits (your choice in GitHub **Watch**) |

There is no separate mailing list; subscribe via GitHub.

## Container image (GHCR)

The image name follows **`ghcr.io/<owner>/<repo>`** (for this upstream: **`ghcr.io/toniop99/agent-detective`** — adjust if you use a fork that publishes its own image).

### How tags move

| Tag | When it updates | Good for |
|-----|-----------------|----------|
| **`latest`** | **Push to `main`** ([docker.yml](../.github/workflows/docker.yml)) (and also written by [release.yml](../.github/workflows/release.yml) for tag builds) | **Moving target** — usually the newest `main` build; not ideal as an immutable production pin |
| **`stable`**, **`X`**, **`X.Y`**, **`X.Y.Z`** | **Version tags** `vX.Y.Z` ([release.yml](../.github/workflows/release.yml)) | **Production-friendly** — pin **`X.Y.Z`** (or a digest) for reproducible deploys |

Because **`main` keeps advancing**, the next push to `main` overwrites **`latest`** even after a release. Use **`X.Y.Z`** or **`stable`** (updated per release) when you want a deliberate upgrade, not the tip of `main`.

### Upgrade runbook (Docker / Compose)

1. Read **[CHANGELOG.md](CHANGELOG.md)** since the tag you currently run (and [migration.md](migration.md) if linked).
2. Update `config` if new or changed keys are required — see [configuration-hub.md](configuration-hub.md) and [configuration.md](configuration.md). Regenerate local reference if you maintain a fork: `pnpm docs:plugins`.
3. **Pull** the new image tag (or bump the digest in your manifest).
4. Redeploy (compose, orchestrator, or `docker run` as you do today).
5. Verify **`GET /api/health`** and a smoke check (e.g. plugin routes, Jira webhook URL unchanged if only the image changed).

Keep **secrets in env** ([configuration.md](configuration.md)); do not bake tokens into images.

## Upgrading from a git clone

For operators who run **`pnpm start`** from a built tree:

```bash
git fetch origin
git checkout <branch-or-tag>   # e.g. main or a release tag
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:app
```

1. Same as above: **CHANGELOG** + **migration** + **config** review.
2. If you change bundled plugin Zod schemas in a fork, run **`pnpm docs:plugins`** and commit [generated/plugin-options.md](generated/plugin-options.md) if you track it.
3. Run tests in CI or locally: `pnpm test`, `pnpm run typecheck` (as in [development.md](development.md)).

## Published npm packages (`@agent-detective/*`)

Workspace packages may be published per [publishing.md](publishing.md). When you depend on them in another project:

- Follow **semver** in that package’s version.
- Read the monorepo **CHANGELOG** when upgrading the app or library — types and plugin options can change together.

## Summary

- **Containers:** pin **`ghcr.io/…:X.Y.Z`** or digest; avoid treating **`latest`** as immutable in production.
- **Config:** merge [configuration-hub.md](configuration-hub.md) rules; watch **CHANGELOG** for breaking keys.
- **Source:** pull, install, build, then deploy; keep `config/local.json` and env out of git.

## See also

- [installation.md](installation.md) — deployment paths
- [docker.md](docker.md#published-image-ghcr) — pull, compose, env
- [publishing.md](publishing.md) — image tags and release automation (maintainers)
