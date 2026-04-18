# Agent Detective - Quick Reference

## Project

TypeScript monorepo (pnpm workspaces) - Express server that processes events via AI agents using a plugin system.

**Packages:**
- `@agent-detective/types` - Shared types (SINGLE SOURCE OF TRUTH)
- `@agent-detective/local-repos-plugin` - Repository management
- `@agent-detective/jira-adapter` - Jira integration

## Golden Rules

### DO
- Import shared types from `@agent-detective/types`
- Use `.ts` for source files, `.test.ts` for tests
- Use ESM with `.js` extension in imports (e.g., `from './foo.js'`)
- Build packages before publishing: `pnpm run build`

### DON'T
- Edit `dist/` files (generated output)
- Use relative imports like `../../../src/core/types.js`
- Create `.js` files alongside `.ts` files
- Set `rootDir` to include multiple directories

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                        Core                          │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │Agent Runner │  │    Queue    │  │   Server   │  │
│  │             │  │  (taskId)   │  │  (Express) │  │
│  └─────────────┘  └─────────────┘  └────────────┘  │
│  ┌─────────────────────────────────────────────┐   │
│  │       Plugin System (schema validation)      │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                            ▲
     ┌──────────────────────┼──────────────────────┐
     │                      │                      │
     │         ┌────────────┴────────────┐       │
     │         │  TaskEvent normalization  │       │
     │         └───────────────────────────┘       │
     │                      │                      │
     │   local-repos-plugin  │  jira-adapter (etc) │
     └──────────────────────┴──────────────────────┘
```

## Key Types

**All shared types:** `packages/types/src/index.ts`

```typescript
interface Plugin {
  name: string;
  version: string;
  schemaVersion?: '1.0';
  schema?: PluginSchema;
  dependsOn?: string[];           // Loaded before this plugin
  register(app: Application, context: PluginContext): void;
}

interface PluginContext {
  agentRunner: AgentRunner;       // Always available
  registerService<T>(name: string, service: T): void;
  getService<T>(name: string): T;
  registerCapability(capability: string): void;
  hasCapability(capability: string): boolean;
  enqueue?: EnqueueFn;
  config: object;                  // Validated config
  logger: Logger;                  // info/warn/error
}

interface TaskEvent {
  source: string;
  type: string;
  payload: unknown;
  timestamp?: string;
}
```

## Plugin Development

### Route Prefixing
Plugin routes are auto-prefixed with `/plugins/{sanitized-name}`:

| Plugin Name | Prefix |
|-------------|--------|
| `@agent-detective/jira-adapter` | `/plugins/agent-detective-jira-adapter` |
| `my-plugin` | `/plugins/my-plugin` |

Register routes with relative paths - prefix is applied automatically.

### Plugin Dependencies
Use `dependsOn` to ensure plugins load in order and services are available:
```typescript
{
  name: '@agent-detective/my-adapter',
  dependsOn: ['@agent-detective/local-repos-plugin'],
  register(app, context) {
    const localReposService = context.getService<LocalReposService>('@agent-detective/local-repos-plugin');
    // localReposService.localRepos, localReposService.buildRepoContext available here
  }
}
```

## Project Structure

```
src/
├── core/
│   ├── agent-runner.ts      # Execute AI agents
│   ├── plugin-system.ts      # Plugin loading + route prefixing
│   ├── queue.ts              # Task queuing
│   └── types.ts              # Re-exports from @agent-detective/types
├── agents/                   # AI agent integrations
├── server.ts                 # Express + Core API endpoints
└── index.ts                  # Bootstrap

packages/
├── types/src/index.ts        # ALL shared types (use this!)
├── local-repos-plugin/src/   # Repository management
└── jira-adapter/src/         # Jira plugin

test/                         # *.test.ts files (tsx --test)
```

## Essential Commands

```bash
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm run lint     # Lint all packages
pnpm run lint -- --fix   # Auto-fix lint issues
pnpm turbo clean  # Clear build cache if odd issues occur
```

## Common Failures

### "Cannot find module '@agent-detective/types'"
**Cause:** Used relative path instead of package import.
**Fix:** Use `@agent-detective/types` - it resolves via workspace.

### Plugin build fails / "rootDir is outside rootDir"
**Cause:** Plugin imports from `../../../src/core/types.js`.
**Fix:** Use `@agent-detective/types` - relative paths to src/ break standalone builds.

### Tests not running / duplicate output
**Cause:** Old `.js` test files alongside `.ts` files.
**Fix:** Delete old `.js` test files. Only `*.test.ts` should exist.

### Module not found after build
**Cause:** Using wrong ESM extension or missing `"type": "module"`.
**Fix:** All imports must use `.js` extension; check package.json.

## Key Files

| File | Purpose |
|------|---------|
| `packages/types/src/index.ts` | All shared type definitions |
| `src/core/plugin-system.ts` | Plugin loading + route prefixing |
| `src/core/agent-runner.ts` | Agent execution |
| `docs/plugins.md` | Full plugin development guide |
| `docs/publishing.md` | Package publishing workflow |
