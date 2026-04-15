# Migration Guide: JavaScript to TypeScript

This document outlines the TypeScript migration completed in 2026 and provides context for future maintenance.

## Overview

The codebase was migrated from JavaScript (ES modules) to TypeScript for:
- Better type safety and IDE support
- Clearer interfaces for plugin development
- Improved code documentation through types

## What Changed

### Package Architecture

```
agent-detective/
├── packages/
│   ├── types/                      # NEW: @agent-detective/types package
│   │   ├── src/index.ts            # Single source of truth for shared types
│   │   └── dist/                   # Compiled output for npm publishing
│   └── jira-adapter/               # Internal plugin (uses @agent-detective/types)
└── src/                            # Main application
    └── core/types.ts               # Re-exports from @agent-detective/types
```

### Shared Types Package: `@agent-detective/types`

All types that are shared between the core and plugins are defined in `packages/types/src/index.ts`. This package:

- Is published to npm as `@agent-detective/types`
- Is used by internal plugins via workspace resolution
- Can be used by external plugins via `npm install @agent-detective/types`

### TypeScript Configuration

| Config | Purpose |
|--------|---------|
| `tsconfig.json` | Base config (noEmit: true) for type checking |
| `tsconfig.build.json` | Build config (outputs to dist/) |

### Old .d.ts Files Cleaned Up

Previously, TypeScript declaration files (`.d.ts`) were generated during build and left in source directories. These have been removed:

- `src/core/types.d.ts`
- `src/core/process.d.ts`

Declaration files are now only generated in `dist/` during build.

### Duplicate repo-context Removed

The `src/core/repo-context/` directory was a duplicate of the same code in `packages/local-repos-plugin/src/repo-context/`. It has been removed - the canonical location is now `packages/local-repos-plugin/src/repo-context/`.

### File Search Removed

The `searchFiles` and `searchErrorPatterns` functions have been removed. AI agents are now responsible for searching files themselves based on the task at hand. This simplifies the codebase and removes the dependency on `ripgrep`.

**Removed types:**
- `SearchResult` interface
- `BuildRepoContextOptions.searchPatterns`
- `BuildRepoContextOptions.errorPatterns`

**Removed files:**
- `packages/local-repos-plugin/src/repo-context/file-search.ts`

### Config Restructured

The `repoContext` configuration has been moved from the root `config/default.json` to the `local-repos-plugin` options:

**Before:**
```json
{
  "repoContext": {
    "gitLogMaxCommits": 50
  },
  "plugins": [{ "package": "@agent-detective/local-repos-plugin", "options": {...} }]
}
```

**After:**
```json
{
  "plugins": [{
    "package": "@agent-detective/local-repos-plugin",
    "options": {
      "repos": [...],
      "repoContext": {
        "gitLogMaxCommits": 50
      }
    }
  }]
}
```

## Migration Notes

### Plugin Development

Plugins should import types from `@agent-detective/types`:

```typescript
import type { Plugin, PluginContext } from '@agent-detective/types';
```

### Build Process

```bash
pnpm install           # Install dependencies
pnpm run build:types  # Build @agent-detective/types → packages/types/dist/
pnpm run build:app    # Build main app → dist/
pnpm run build:plugin # Build plugin → packages/jira-adapter/dist/
```

### Running in Development

```bash
pnpm run dev          # Run with tsx (no build step needed)
pnpm run test         # Run tests with tsx
```

## Common Issues Resolved

### 1. Path Aliases

Before: `import { Plugin } from '../../../src/core/types.js'`
After: `import type { Plugin } from '@agent-detective/types'`

### 2. rootDir Conflicts

Internal plugins cannot import from `src/` because `rootDir` is set to `./src` in plugin tsconfig.build.json. Solution: use `@agent-detective/types` which is resolved via workspace.

### 3. Function Type Imports

Before:
```typescript
buildRepoContext: typeof import('./repo-context/index.js').buildRepoContext
```

After:
```typescript
buildRepoContext: (repoPath: string, options?: BuildRepoContextOptions) => Promise<RepoContext>
```

Inline function signatures avoid circular dependencies between packages.

## File Extensions

All source files now use `.ts` extension. Tests use `.test.ts`.

When importing:
```typescript
// Source files
import { queue } from './queue.js';

// Tests
import { queue } from '../src/core/queue.js';
```

## Type Definitions

All types are defined in `packages/types/src/index.ts`:

- **TaskEvent interfaces**: TaskEvent, TaskContext, ReplyTarget
- **Plugin interfaces**: Plugin, PluginSchema, PluginContext, Logger
- **Agent interfaces**: Agent, AgentRunner, AgentOutput, StreamingOutput
- **Repository interfaces**: RepoContext, RepoMapping, Commit
- **Process interfaces**: ExecLocalOptions, ProcessUtils

## Testing

Tests run with `tsx --test` directly on TypeScript files:

```bash
pnpm run test          # Run all tests
pnpm run test:watch    # Watch mode
```

## Package Reorganization

### process-utils Package

Process utilities (`execLocal`, `execLocalStreaming`, `terminateChildProcess`, `shellQuote`, `wrapCommandWithPT`) were moved from `packages/local-repos-plugin/src/process.ts` to a dedicated `packages/process-utils/` package.

This allows sharing these utilities across multiple packages without circular dependencies.

**Old location:** `packages/local-repos-plugin/src/process.ts`
**New location:** `packages/process-utils/src/index.ts`

**Migration:** Update imports:
```typescript
// Before
import { execLocal, execLocalStreaming } from '../../local-repos-plugin/src/process.js';

// After
import { execLocal, execLocalStreaming } from '@agent-detective/process-utils';
```

### observability Package

A new observability package was added to provide structured logging, metrics, tracing, and health checks.

**Location:** `packages/observability/`

**Components:**
- `src/config.ts` — Configuration schema and defaults
- `src/logger.ts` — Structured JSON logger
- `src/metrics.ts` — Prometheus-compatible metrics
- `src/tracing.ts` — Distributed tracing context
- `src/health.ts` — Health check endpoints
- `src/middleware.ts` — HTTP middleware (request logging, correlation)

See [docs/observability.md](observability.md) for full documentation.

---

## Future Work

- Consider migrating remaining `.js` config files to `.json` with schema validation
- Add integration tests with actual plugins
- Document agent-specific configuration options