# Publishing Guide

This guide covers how to publish packages to npm for the agent-detective monorepo.

## Package Overview

The **root** `agent-detective` app is **`"private": true`** and is **not** published to npm. Publish **workspace packages** under `packages/` (via Changesets) as needed.

| Package | Description |
|---------|-------------|
| `@agent-detective/types` | Shared TypeScript types |
| `@agent-detective/core` | OpenAPI / HTTP controller helpers |
| `@agent-detective/observability` | Logging, metrics, health |
| `@agent-detective/process-utils` | Process / shell helpers |
| `@agent-detective/local-repos-plugin` | Local repo + matcher plugin |
| `@agent-detective/jira-adapter` | Jira adapter plugin |

## Prerequisites

1. **npm account** with appropriate organization access
2. **pnpm** installed: `npm install -g pnpm`
3. **2FA enabled** on your npm account (recommended)
4. **Clean git state** with all changes committed

## Pre-Publishing Checklist

- [ ] All tests pass: `pnpm run test`
- [ ] TypeScript check passes: `pnpm run typecheck`
- [ ] Build succeeds: `pnpm run build`
- [ ] Git working directory is clean
- [ ] Version numbers updated

## Publishing Workflow

This monorepo uses [Changesets](https://github.com/changesets/changesets) for version management.

### Standard Release Flow

```bash
# 1. Ensure clean state
git status  # Should show clean working directory

# 2. Run pre-release checks
pnpm run test
pnpm run typecheck
pnpm run lint
pnpm run build

# 3. Create a changeset (describe what changed)
pnpm changeset

# 4. Apply version bumps (updates package.json files)
pnpm changeset version

# 5. Build with new versions
pnpm run build

# 6. Commit version changes
git add -A
git commit -m "chore: release vX.Y.Z"
git push

# 7. Publish packages
pnpm publish -r --access public
```

### Changeset File Format

When you run `pnpm changeset`, it creates a file in `.changeset/` with this format:

```markdown
---
"@agent-detective/types": patch
"@agent-detective/jira-adapter": minor
---

Description of changes
```

**Version types:**
- `patch` - Bug fixes (1.0.0 → 1.0.1)
- `minor` - New features (1.0.0 → 1.1.0)
- `major` - Breaking changes (1.0.0 → 2.0.0)

### Single Package Hotfix

```bash
# Create changeset for specific package
echo '{"changesets":[]}' > .changeset/skip-versioning.md
pnpm changeset add --empty

# Or manually edit version in package.json
cd packages/types
pnpm version patch
cd ../..
pnpm run build
cd packages/types && pnpm publish --access public
```

## Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes to types or APIs
- **MINOR** (1.0.0 → 1.1.0): New types, new plugin features (backward compatible)
- **PATCH** (1.0.0 → 1.0.1): Bug fixes, documentation updates

### Version Compatibility

| @agent-detective/types | agent-detective |
|----------------------|----------------|
| 1.x | 0.x |
| 2.x | 1.x (when released) |

## For External Plugin Developers

### Installing Types Package

```bash
npm install @agent-detective/types
# or
pnpm add @agent-detective/types
```

### Using Types in Your Plugin

```typescript
import type { Plugin, PluginContext, TaskEvent } from '@agent-detective/types';

const myPlugin: Plugin = {
  name: '@myorg/my-adapter',
  version: '1.0.0',
  schemaVersion: '1.0',
  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
    },
    required: [],
  },
  register(app, context: PluginContext) {
    // context.agentRunner, context.repoMapping, etc.
  }
};

export default myPlugin;
```

## Workspace vs Published Versions

Within the monorepo, packages use `workspace:*` for dependencies:

```json
// packages/jira-adapter/package.json
{
  "dependencies": {
    "@agent-detective/types": "workspace:*"
  }
}
```

When published to npm, pnpm automatically replaces `workspace:*` with the actual version.

## Troubleshooting

### "You must be logged in to publish packages"

```bash
npm login
# or
pnpm login
```

### "You need to authorize this package for public access"

```bash
# First time publishing a new scope
npm org add @agent-detective your-username
```

### "Cannot find module" after publish

Check that `dist/index.js` and `dist/index.d.ts` exist in the published package.

### Version conflict errors

```bash
# Clear pnpm cache
pnpm store prune
pnpm install
```

## CI/CD Considerations

For automated releases, consider:

1. Using GitHub Actions to run tests and builds
2. Using `release-please` or similar for automated version bumps
3. Adding npm tokens as GitHub Secrets

Example GitHub Action workflow:

```yaml
name: Release
on:
  push:
    tags:
      - 'v*'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run test
      - run: pnpm run build
      - run: pnpm publish -r --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Unpublishing

If you need to unpublish a version:

```bash
# Unpublish specific version
npm unpublish @agent-detective/types@1.0.1

# Unpublish entire package (use with caution)
npm unpublish @agent-detective/types --force
```

Note: You cannot unpublish a version if another package depends on it.

---

## Docker Image Publishing (ghcr.io)

The agent-detective Docker image is published to GitHub Container Registry (ghcr.io).

### Image Information

| Item | Value |
|------|-------|
| Registry | ghcr.io |
| Organization | toniop99 |
| Repository | agent-detective |
| Visibility | Public |

### Image Tags

| Tag | Description | Updated |
|-----|-------------|---------|
| `latest` | Latest build from main branch | Every push to main |
| `stable` | Latest release | On version tag |
| `1`, `1.0`, `1.0.0` | Version-specific tags | On version tag |

### GitHub Actions Workflows

The repository includes two workflows:

#### docker.yml (Build on Push)

- **Trigger:** Push to `main` branch
- **Action:** Builds and pushes Docker image with `latest` tag
- **Platforms:** linux/amd64, linux/arm64

#### release.yml (Build on Version Tag)

- **Trigger:** Push of tag `v*.*.*`
- **Action:** Builds and pushes Docker image with all version tags
- **Platforms:** linux/amd64, linux/arm64

### Manual Image Build

```bash
# Build locally
docker build --target production \
  --build-arg AGENTS="opencode,claude,gemini" \
  -t ghcr.io/toniop99/agent-detective:latest .

# Login to ghcr.io
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Push
docker push ghcr.io/toniop99/agent-detective:latest
```

### Version Tagging

```bash
# Create a version tag
git tag v1.0.0
git push origin v1.0.0

# This triggers release.yml which:
# 1. Builds the image
# 2. Pushes with tags: latest, stable, 1, 1.0, 1.0.0
# 3. Creates a GitHub Release
```

### Agent Selection at Build Time

Build arguments control which agents are installed:

```bash
# Build with default agents (opencode only)
docker build --target production -t agent-detective .

# Build with multiple agents
docker build --target production \
  --build-arg AGENTS="opencode,claude,gemini" \
  -t agent-detective:multi .

# Available agents: opencode, claude, gemini
# Note: codex is not available in Docker (requires VS Code extension)
```

### Docker Image Structure

```
ghcr.io/toniop99/agent-detective:latest
├── dist/              # Built application
├── config/            # Default config
├── plugins/           # Third-party plugins (volume mount)
│   └── .gitkeep
└── node_modules/     # Dependencies + bundled plugins
```

### Pulling the Image

```bash
# Latest
docker pull ghcr.io/toniop99/agent-detective:latest

# Specific version
docker pull ghcr.io/toniop99/agent-detective:1.0.0

# Stable
docker pull ghcr.io/toniop99/agent-detective:stable
```