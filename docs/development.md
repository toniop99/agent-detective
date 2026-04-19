# Development Guide

## Prerequisites

- Node.js 24+
- pnpm 8.15.9+
- Access to repositories on local filesystem
- (Optional) Jira Cloud account for real integration
- (Optional) Docker — see [Docker & CI images](docker.md) for compose-based local dev

## Installation

```bash
cd agent-detective
pnpm install
```

## Configuration

See **[configuration.md](configuration.md)** for `default.json` / `local.json` merge rules, supported environment variables, and generated plugin option schemas.

### Edit `config/default.json`

```json
{
  "port": 3001,
  "agent": "opencode",
  "plugins": [
    {
      "package": "@agent-detective/local-repos-plugin",
      "options": {
        "repos": [
          {
            "name": "my-project",
            "path": "/path/to/your/project",
            "description": "Your project description"
          }
        ],
        "techStackDetection": {
          "enabled": true
        },
        "validation": {
          "validateOnStartup": true,
          "failOnMissing": false
        }
      }
    },
    {
      "package": "@agent-detective/jira-adapter",
      "options": {
        "enabled": true,
        "webhookPath": "/plugins/agent-detective-jira-adapter/webhook/jira",
        "mockMode": true,
        "discovery": {
          "enabled": true,
          "useAgentForDiscovery": true,
          "directMatchOnly": false,
          "fallbackOnNoMatch": "ask-agent"
        }
      }
    }
  ]
}
```

## Running

```bash
# Production
pnpm start

# Development (with auto-reload using tsx)
pnpm run dev
```

## Building

```bash
# Build all packages (uses Turborepo for caching)
pnpm run build

# TypeScript type checking
pnpm run typecheck

# ESLint check
pnpm run lint

# Clean dist/ folders
pnpm run clean

# Clear Turborepo cache
pnpm turbo clean
```

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm run test:watch
```

## Project Structure

```
agent-detective/
├── src/                              # Main application (TypeScript)
│   ├── core/
│   │   ├── types.ts                  # Re-exports from @agent-detective/types
│   │   ├── agent-runner.ts           # Executes prompts against AI agents
│   │   ├── queue.ts                  # Task queuing (prevents parallel execution)
│   │   ├── process.ts                # Shell command execution
│   │   ├── plugin-system.ts          # Plugin loader & registry
│   │   └── schema-validator.ts       # Plugin schema validation
│   ├── agents/                       # AI agent integrations
│   │   ├── index.ts                  # Agent registry
│   │   ├── opencode.ts
│   │   ├── codex.ts
│   │   ├── codex-app.ts
│   │   ├── claude.ts
│   │   ├── gemini.ts
│   │   └── utils.ts
│   ├── server.ts                     # Express server (+ Core API endpoints)
│   └── index.ts                      # Bootstrap
├── packages/                         # Workspace packages
│   ├── types/                        # @agent-detective/types (shared types)
│   │   ├── src/index.ts              # SINGLE SOURCE OF TRUTH for types
│   │   └── dist/                     # Built output for npm
│   ├── local-repos-plugin/          # Repository management plugin
│   │   ├── src/
│   │   │   ├── index.ts              # Plugin entry
│   │   │   ├── types.ts              # LocalReposConfig, ValidatedRepo interfaces
│   │   │   ├── validate.ts           # Path validation
│   │   │   ├── tech-stack-detector.ts # Auto-detect tech stack
│   │   │   └── repo-context/        # Git log + file search
│   │   └── dist/
│   └── jira-adapter/                 # Official Jira plugin
│       ├── src/
│       │   ├── index.ts              # Plugin entry
│       │   ├── types.ts              # JiraAdapterConfig, discovery prompts
│       │   ├── discovery.ts          # Repo discovery logic
│       │   ├── webhook-handler.ts   # Webhook processing
│       │   ├── normalizer.ts        # Jira payload → TaskEvent
│       │   └── mock-jira-client.ts # In-memory Jira client
│       └── dist/
├── test/                             # Main app tests
│   └── core/
├── config/
│   └── default.json                  # Server configuration
└── docs/                             # Documentation
```

## Running Plugin Tests

```bash
cd packages/jira-adapter
pnpm test
```

## Testing Jira Adapter with Mock Mode

When `mockMode: true` in plugin config, the adapter uses `mock-jira-client.ts` which stores comments in memory:

```bash
# Test webhook locally
curl -X POST http://localhost:3001/plugins/agent-detective-jira-adapter/webhook/jira \
  -H "Content-Type: application/json" \
  -d @packages/jira-adapter/test/fixtures/issue-created.json
```

## Debugging

### Enable Debug Logging

The core modules use `console.info`/`console.warn` for operational logging.

### Common Issues

**Port already in use**
```bash
lsof -ti:3001 | xargs kill
```

**Plugin fails to load**
Check the console output - plugins log warnings instead of crashing.

**Repository not found**
- Verify `config/default.json` has correct repo paths
- Ensure the agent has read permissions on the repo directory

**Agent not responding**
- Check the agent is installed and on PATH
- Try running standalone: `echo "hello" | opencode exec "say hi"`

## Creating a New Plugin

For a complete plugin development guide, see [docs/plugins.md](plugins.md).

For type definitions, plugins should import from `@agent-detective/types`:

```typescript
import type { Plugin, PluginContext } from '@agent-detective/types';
```
