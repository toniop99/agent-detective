# Agent Detective - Agent Guide

This file provides essential information for AI agents working on this codebase.

## Project Overview

- **TypeScript monorepo** using pnpm workspaces
- **Main app**: Express server that processes events via AI agents
- **Packages**: `@agent-detective/types`, `@agent-detective/local-repos-plugin`, `@agent-detective/jira-adapter`
- **Architecture**: Source-agnostic core with plugin-based adapters

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Core                             │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │Agent Runner │  │    Queue    │  │  Server    │  │
│  │ (opencode,  │  │ (by taskId) │  │  (Express) │  │
│  │ codex, etc) │  │             │  │            │  │
│  └─────────────┘  └─────────────┘  └────────────┘  │
│  ┌────────────────────────────────────────────┐   │
│  │          Plugin System (schema validation)   │   │
│  └────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
┌─────────┴────────┐  ┌────┴────────┐  ┌────┴────────┐
│local-repos-plugin│  │jira-adapter │  │  (future)   │
│ - Repo config    │  │ - Discovery │  │  adapters   │
│ - Tech stack    │  │ - Analysis  │  │             │
│ - Validation    │  │ - Comments  │  │             │
└─────────────────┘  └─────────────┘  └─────────────┘
```
┌─────────────────────────────────────────────────────┐
│                     Core                             │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │Agent Runner │  │    Queue    │  │Repo Context│  │
│  │ (opencode,  │  │ (by taskId) │  │git+search  │  │
│  │ codex, etc) │  │             │  │            │  │
│  └─────────────┘  └─────────────┘  └────────────┘  │
│  ┌────────────────────────────────────────────┐   │
│  │          Plugin System (schema validation)   │   │
│  └────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                          ▲
                          │ TaskEvent
     ┌────────────────────┼────────────────────┐
     │                    │                    │
┌────┴────┐         ┌─────┴─────┐       ┌─────┴─────┐
│   Jira   │         │ Telegram  │       │   Slack   │
│  Plugin  │         │  Plugin   │       │  Plugin   │
└──────────┘         └───────────┘       └───────────┘
```

## Type System

### Critical Rule

**All types shared between core and plugins are defined in `@agent-detective/types` package.**

```typescript
// ✅ CORRECT - import from @agent-detective/types
import type { Plugin, PluginContext } from '@agent-detective/types';

// ❌ WRONG - will break plugin standalone builds
import type { Plugin } from '../../../src/core/types.js';
```

### Key Types (from `packages/types/src/index.ts`)

| Type | Purpose |
|------|---------|
| `TaskEvent` | Normalized event from any source |
| `Plugin` | Plugin interface (`name`, `version`, `register`, `schema`) |
| `PluginContext` | Context injected into plugins |
| `AgentRunner` | Run AI agents with prompts |
| `RepoMapping` | Resolve repo paths from labels/keys |

### Plugin Interface Summary

```typescript
interface Plugin {
  name: string;
  version: string;
  schemaVersion?: '1.0';
  schema?: PluginSchema;
  dependsOn?: string[];  // Plugin dependencies (loaded before this plugin)
  register(app: Express.Application, context: PluginContext): void;
}
```

### Plugin Dependencies

Plugins can declare dependencies using `dependsOn`. The plugin system loads plugins in topological order (dependencies first).

```typescript
const myPlugin: Plugin = {
  name: '@agent-detective/my-adapter',
  version: '1.0.0',
  dependsOn: ['@agent-detective/local-repos-plugin'],  // Loaded first
  register(app, context) {
    // context.repoMapping, context.buildRepoContext available here
  }
};
```

## Plugin Development

Plugins are ES modules that:
1. Normalize source events → `TaskEvent`
2. Register routes with Express
3. Use `PluginContext` to access core services

### PluginContext Members

| Member | Type | Required | Description |
|--------|------|----------|-------------|
| `agentRunner` | `AgentRunner` | Yes | Run AI agents |
| `localRepos` | `LocalReposContext` | No | Repository info (provided by local-repos-plugin) |
| `buildRepoContext` | `function` | No | Analyze repository (provided by local-repos-plugin) |
| `formatRepoContextForPrompt` | `function` | No | Format for prompts (provided by local-repos-plugin) |
| `enqueue` | `EnqueueFn` | No | Task queue serialization |
| `config` | `object` | Yes | Validated config with defaults |
| `logger` | `Logger` | Yes | Logger with info/warn/error |

### Plugin Route Prefixing

All plugin routes are automatically prefixed with `/plugins/{plugin-name}` to ensure consistent naming conventions. Plugin names are sanitized by removing the `@` prefix and replacing `/` with `-`.

| Plugin Name | Sanitized Prefix |
|------------|------------------|
| `@agent-detective/jira-adapter` | `/plugins/agent-detective-jira-adapter` |
| `@agent-detective/local-repos-plugin` | `/plugins/agent-detective-local-repos-plugin` |
| `my-plugin` | `/plugins/my-plugin` |

**Example**: If a plugin registers `/webhook/jira`, the actual endpoint becomes `/plugins/agent-detective-jira-adapter/webhook/jira`.

Plugins should use relative paths (e.g., `/webhook/jira`) when registering routes - the prefix is automatically applied by core.

### local-repos-plugin

Provides repository management for local filesystems:

**Config Options:**
```typescript
interface LocalReposPluginOptions {
  repos: Array<{
    name: string;           // Unique identifier
    path: string;          // Path to repository
    description?: string;   // Manual description
    techStack?: string[];  // Manual tech stack
  }>;
  techStackDetection?: {
    enabled?: boolean;
    patterns?: Record<string, string[]>;
  };
  summaryGeneration?: {
    enabled?: boolean;
    source?: 'readme' | 'commits' | 'both';
    maxReadmeLines?: number;
    commitCount?: number;
    useAgent?: boolean;        // Use AI agent for summary generation
    agentId?: string;          // Agent to use (default: 'opencode')
    model?: string;           // Optional model override
    summaryPrompt?: string;   // Custom prompt for summary
  };
  validation?: {
    validateOnStartup?: boolean;
    failOnMissing?: boolean;
  };
  repoContext?: {
    gitLogMaxCommits?: number;
  };
}
```

**Agent-based Summary Generation:**
When `summaryGeneration.useAgent: true`, the plugin uses an AI agent to generate repository summaries. If the agent fails, it falls back to pattern-based summary with a warning log.

| Field | Default | Description |
|-------|---------|-------------|
| `useAgent` | `false` | Enable AI-powered summary |
| `agentId` | `"opencode"` | Which agent to use |
| `model` | `undefined` | Optional model override for the agent |
| `summaryPrompt` | `"Summarize..."` | Custom prompt for summary generation |

**Context Provided:**
```typescript
interface LocalReposContext {
  repos: ValidatedRepo[];
  getRepo(name: string): ValidatedRepo | null;
  getAllRepos(): ValidatedRepo[];
}

interface ValidatedRepo {
  name: string;
  path: string;
  exists: boolean;
  techStack: string[];
  summary: string;
}
```

### jira-adapter

Handles Jira webhooks and repository discovery:

**Config Options:**
```typescript
interface JiraAdapterOptions {
  enabled?: boolean;
  webhookPath?: string;
  mockMode?: boolean;
  
  discovery?: {
    enabled?: boolean;
    useAgentForDiscovery?: boolean;
    discoveryAgentId?: string;
    directMatchOnly?: boolean;
    fallbackOnNoMatch?: 'ask-agent' | 'use-first' | 'skip-analysis';
  };
  
  discoveryContext?: {
    includeTechStack?: boolean;
    includeSummary?: boolean;
    maxReposShown?: number;
  };
  
  analysisPrompt?: string;   // Custom analysis prompt
  discoveryPrompt?: string;  // Custom discovery prompt
}
```

**Discovery Flow:**
1. Check if any label matches a repo name directly
2. If no match, ask the agent with repo context (tech stack + summary)

## Agent System

### Agent Interface

```typescript
interface Agent {
  id: string;
  label: string;
  command?: string;
  buildCommand?(opts: BuildCommandOptions): string;
  parseOutput?(output: string): AgentOutput;
  defaultModel?: string;
}
```

### AgentRunner

Executes prompts against AI agents:

```typescript
interface AgentRunner {
  runAgentForChat(
    taskId: string,
    prompt: string,
    options?: RunAgentOptions
  ): Promise<string>;
  stopActiveRun(taskId: string, contextKey?: string): Promise<StopRunResult>;
}
```

### Available Agents

| Agent | Config Value | Description |
|-------|-------------|-------------|
| opencode | `"opencode"` | OpenCode agent |
| codex | `"codex"` | Codex agent |
| codex-app | `"codex-app"` | Codex App agent |
| claude | `"claude"` | Claude agent |
| gemini | `"gemini"` | Gemini agent |

## Core API Endpoints

The core provides REST API endpoints for direct agent execution without plugins:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/agent/list` | GET | List available agents |
| `/agent/run` | POST | Execute an agent (supports SSE streaming) |
| `/events` | POST | Receive raw events (supports SSE streaming) |
| `/queue/status` | GET | Queue status (placeholder) |

### POST /agent/run

Execute an agent directly:

```bash
curl -X POST http://localhost:3001/agent/run \
  -H "Content-Type: application/json" \
  -d '{"agentId": "opencode", "prompt": "Explain this error"}'
```

With streaming (SSE):
```bash
curl -X POST http://localhost:3001/agent/run \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"agentId": "opencode", "prompt": "Analyze"}'
```

### GET /agent/list

List all agents with availability status:

```json
[
  {"id": "opencode", "label": "opencode", "available": true},
  {"id": "claude", "label": "claude", "available": false}
]
```

## Project Structure

```
agent-detective/
├── src/                              # Main application
│   ├── core/
│   │   ├── types.ts                  # Re-exports from @agent-detective/types
│   │   ├── agent-runner.ts           # Executes AI agents
│   │   ├── queue.ts                 # Task queuing
│   │   ├── process.ts               # Shell execution
│   │   ├── plugin-system.ts         # Plugin loading (with route prefixing)
│   │   └── schema-validator.ts     # Schema validation
│   ├── agents/                      # AI agent integrations
│   ├── server.ts                    # Express server (+ Core API endpoints)
│   └── index.ts                     # Bootstrap
├── packages/
│   ├── types/                       # @agent-detective/types
│   │   └── src/index.ts            # SINGLE SOURCE OF TRUTH
│   ├── local-repos-plugin/          # Repository access and analysis
│   │   └── src/index.ts
│   └── jira-adapter/               # Official Jira plugin
│       └── src/index.ts            # Plugin entry (dependsOn: local-repos-plugin)
├── test/                           # Tests (tsx --test)
│   └── core/
└── config/                         # Configuration
    └── default.json
```

## Monorepo Tooling

This project uses a modern TypeScript monorepo setup with the following tools:

### Turborepo

Task orchestration and build caching. Key features:
- **Build caching**: Results are cached based on file inputs
- **Task parallelism**: Independent tasks run concurrently
- **Dependency awareness**: `dependsOn: ["^build"]` ensures packages build in correct order

```bash
pnpm turbo clean    # Clear all caches
pnpm turbo --help   # See all options
```

### tsup

Fast TypeScript build tool for packages:
- 10x faster than tsc for builds
- Built-in d.ts generation
- ESM output with proper exports

### Changesets

Version management for packages:
```bash
pnpm changeset        # Create a changeset (run after code changes)
pnpm changeset version # Apply version bumps
pnpm run build && pnpm publish  # Publish packages
```

### ESLint

Code linting with typescript-eslint:
```bash
pnpm run lint        # Lint all packages
pnpm run lint -- --fix  # Auto-fix issues
```

## Common Issues & Solutions

### "Cannot find module '@agent-detective/types'"

**Cause**: Relative import path used instead of package import.

**Fix**: Use `@agent-detective/types` import path, ensure tsconfig has path mapping:
```json
"paths": {
  "@agent-detective/types": ["./packages/types/src/index.ts"]
}
```

### "rootDir is outside rootDir" / Plugin build fails

**Cause**: Plugin's `tsconfig.build.json` has `rootDir: "./src"` but imports from `../../../src/core/types.js`.

**Fix**: Use `@agent-detective/types` which resolves via workspace. Do NOT use relative paths to `src/`.

### Tests not running / duplicate test output

**Cause**: Both `.js` and `.ts` test files exist.

**Fix**: Delete old `.js` test files. Only `.test.ts` files should exist.

### Build succeeds but app crashes with module not found

**Cause**: Running compiled `dist/` but imports don't resolve correctly.

**Fix**: Ensure all imports use proper ESM `.js` extension. Check `package.json` has `"type": "module"`.

### TypeScript errors after migration

**Cause**: Old `.d.ts` declaration files left in source directories.

**Fix**: Delete all `*.d.ts` and `*.d.ts.map` from `src/`. Only `dist/` should have declaration files.

## Constraints

### DO NOT

- **Edit `dist/` files directly** - they are generated output
- **Use relative imports to `src/core/types.js`** - use `@agent-detective/types`
- **Create `.js` files alongside `.ts` files** - delete old files after migration
- **Use `typeof import()` for function signatures** - use inline function types
- **Set `rootDir` to include multiple directories** - each package has its own rootDir

### DO

- **Import types from `@agent-detective/types`**
- **Use `.ts` extension for all source files**
- **Use `.test.ts` extension for test files**
- **Follow ESM with `.js` extension in imports**
- **Build before publishing packages**

## Package Publishing Order

When releasing:

1. **`@agent-detective/types`** (publish first)
2. **`@agent-detective/jira-adapter`** (depends on types)
3. **`agent-detective`** (main app)

See `docs/publishing.md` for full workflow.

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/types/src/index.ts` | All shared type definitions |
| `src/core/plugin-system.ts` | Plugin loading logic |
| `src/core/agent-runner.ts` | Agent execution |
| `src/core/queue.ts` | Task queuing |
| `packages/jira-adapter/src/index.ts` | Example plugin implementation |
| `turbo.json` | Turborepo pipeline configuration |
| `eslint.config.js` | ESLint flat config with typescript-eslint |
| `tsup.config.ts` | tsup build config (in each package) |
| `.changeset/config.json` | Changesets version management |
| `docs/plugins.md` | Full plugin development guide |
| `docs/publishing.md` | npm publishing workflow |
| `docs/monorepo.md` | Monorepo architecture and tooling |