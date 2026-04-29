---
title: "Staying up to date"
description: Upgrade runbooks for native binaries, git clones, and published npm packages.
sidebar:
  order: 4
---

# Staying up to date

Use this page when you deploy from a **GitHub Release binary**, track **main** in git, or consume **published npm packages** from this monorepo. It ties together GitHub Releases and [migration.md](../development/migration.md).

**Other operator hubs:** [installation.md](installation.md) (deploy paths) · [configuration-hub.md](../config/configuration-hub.md) (config load order and keys).

## How to learn about changes

| Channel | Use for |
|---------|---------|
| **GitHub Releases** | Breaking or notable config and API changes in the repo |
| **[migration.md](../development/migration.md)** | Short archive of config moves and conventions (not a full version history) |
| **GitHub Releases** | Created when a **`v*.*.*`** tag is pushed; native binary assets are uploaded by [.github/workflows/binary.yml](../../.github/workflows/binary.yml); release notes are created by [.github/workflows/release.yml](../../.github/workflows/release.yml) |
| **Watching the repository** | Notifications for releases, discussions, or commits (your choice in GitHub **Watch**) |

There is no separate mailing list; subscribe via GitHub.

## Upgrading the native binary

1. Read GitHub Release notes since the version you run (and [migration.md](../development/migration.md) if linked).
2. Update `config` if new or changed keys are required — see [configuration-hub.md](../config/configuration-hub.md) and [configuration.md](../config/configuration.md).
3. Replace the executable with the new release asset for your platform; keep `config/` and optional `plugins/` in place.
4. Restart the process (systemd, or your supervisor).
5. Verify **`GET /api/health`** and a smoke check (e.g. plugin routes, Jira webhook URL unchanged if only the binary changed).

Keep **secrets in env** ([configuration.md](../config/configuration.md)); do not bake tokens into world-readable install trees.

Verification and layout: [binary.md](binary.md).

## Upgrading from a git clone

For operators who run **`pnpm start`** from a built tree:

```bash title="Pull and rebuild from source"
git fetch origin
git checkout <branch-or-tag>   # e.g. main or a release tag
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:app
```

1. Same as above: release notes + **migration** + **config** review.
2. If you change bundled plugin Zod schemas in a fork, run **`pnpm docs:plugins`** and commit [generated/plugin-options.md](../reference/generated/plugin-options.md) if you track it.
3. Run tests in CI or locally: `pnpm test`, `pnpm run typecheck` (as in [development.md](../development/development.md)).

## Published npm packages (`@agent-detective/*`)

Workspace packages may be published per [publishing.md](../plugins/publishing.md). When you depend on them in another project:

- Follow **semver** in that package’s version.
- Read the monorepo **CHANGELOG** when upgrading the app or library — types and plugin options can change together.

## Summary

:::tip[Key takeaways]
- **Binaries:** download the matching platform asset for each release; use checksums and Sigstore bundles from the same release when verifying.
- **Config:** merge [configuration-hub.md](../config/configuration-hub.md) rules; watch **CHANGELOG** for breaking keys.
- **Source:** pull, install, build, then deploy; keep `config/local.json` and env out of git.
:::

## See also

- [configuration-hub.md](../config/configuration-hub.md) — where settings live
- [installation.md](installation.md) — deployment paths
- [releasing.md](releasing.md) — maintainers: create a new tag/release
- [publishing.md](../plugins/publishing.md) — npm publish mechanics (maintainers)
