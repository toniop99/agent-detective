# Monorepo Architecture

This document describes the monorepo structure, tooling, and architecture decisions.

## Overview

The agent-detective project is a TypeScript monorepo using:
- **pnpm workspaces** for package management
- **Turborepo** for task orchestration and build caching
- **tsup** for fast TypeScript package builds
- **Changesets** for version management

## Package Structure

```
agent-detective/                    # Root (private, not published)
├── packages/
│   ├── types/                    # @agent-detective/types
│   │   ├── src/index.ts          # Shared type definitions
│   │   ├── tsup.config.ts        # Build configuration
│   │   └── dist/                 # Built output
│   └── jira-adapter/             # @agent-detective/jira-adapter
│       ├── src/
│       ├── test/
│       ├── tsup.config.ts        # Build configuration
│       └── dist/                 # Built output
├── src/                          # Main application (not a package)
├── apps/                         # Future: additional apps
└── .changeset/                  # Changeset files for versioning
```

## Configuration Files

### pnpm-workspace.yaml

Defines which directories contain packages:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

### .npmrc

pnpm configuration for consistent behavior:

```ini
shamefully-hoist=false       # No hoisting (pnpm default)
strict-peer-dependencies=false
auto-install-peers=true
save-workspace-protocol=rolling  # Use workspace:* instead of version
link-workspace-packages=deep    # Link packages across workspace
```

### turbo.json

Turborepo pipeline configuration:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],    # Build deps first
      "outputs": ["dist/**"],
      "cache": true
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "cache": true
    },
    "lint": {
      "outputs": [],
      "cache": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"],
      "cache": true
    }
  }
}
```

### tsup.config.ts

Build configuration for packages using tsup:

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  clean: true,
});
```

## Build Pipeline

### Build Order

When running `pnpm run build`, Turborepo ensures correct build order:

1. **@agent-detective/types** builds first (no dependencies)
2. **@agent-detective/jira-adapter** builds second (depends on types)

The `dependsOn: ["^build"]` in turbo.json ensures dependencies build before dependents.

### tsup vs tsc

| Aspect | tsc | tsup |
|--------|-----|------|
| Speed | Slower | 10x faster |
| Types | Built-in | Built-in (via dts) |
| Formats | ESM/CJS | ESM (primary) |
| Config | tsconfig.build.json | tsup.config.ts |

## Workspace Dependencies

### Version Resolution

Within the monorepo, packages reference each other using `workspace:*`:

```json
// packages/jira-adapter/package.json
{
  "dependencies": {
    "@agent-detective/types": "workspace:*"
  }
}
```

When published, pnpm replaces `workspace:*` with the actual version.

### Type Imports

All type imports between packages should use `@agent-detective/types`:

```typescript
// ✅ Correct
import type { Plugin, PluginContext } from '@agent-detective/types';

// ❌ Wrong - will break plugin builds
import type { Plugin } from '../../../src/core/types.js';
```

## Scripts Reference

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm run build` | Build all packages (cached) |
| `pnpm run typecheck` | TypeScript check (cached) |
| `pnpm run lint` | ESLint check (cached) |
| `pnpm run test` | Run tests (cached) |
| `pnpm run clean` | Clean dist/ folders |
| `pnpm turbo clean` | Clear Turborepo cache |
| `pnpm changeset` | Create changeset |
| `pnpm changeset version` | Apply version bumps |
| `pnpm publish -r` | Publish all packages |

## Adding New Packages

### 1. Create Package Structure

```bash
mkdir -p packages/my-adapter/src
```

### 2. Package.json

```json
{
  "name": "@agent-detective/my-adapter",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "tsx --test",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@agent-detective/types": "workspace:*"
  }
}
```

### 3. Create tsup.config.ts

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['@agent-detective/types'],
});
```

### 4. Create tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

## Turborepo Cache

### Local Cache

Turborepo caches build outputs locally in `.turbo/`:

```
.turbo/
├── cache/
│   ├── types#build/
│   └── jira-adapter#build/
└── logs/
```

### Cache Invalidation

Cache is invalidated when:
- Input files change (hash-based)
- Dependencies change
- Task command changes
- `outputs` patterns change

### Clear Cache

```bash
pnpm turbo clean    # Clear local cache
```

## VS Code Configuration

Recommended `.vscode/settings.json`:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

This ensures VS Code uses the workspace TypeScript version for IntelliSense.
