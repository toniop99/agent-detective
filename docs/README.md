# Code Detective

AI-powered code analysis agent that responds to events from Jira, Telegram, Slack and more.

## Concept

When a new incident is created in Jira, this agent analyzes the relevant repository to identify possible causes and writes a detailed comment in the Jira issue to help developers resolve it.

The architecture is designed to be **source-agnostic**: the core agent logic doesn't know or care where the event came from. Different adapters (Jira, Telegram, Slack) are loaded as plugins that normalize their events into a common format that the core processes identically.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Core                                │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │ Agent Runner│  │    Queue    │  │  Repo Context     │   │
│  │             │  │  (by task)  │  │  - git log        │   │
│  │             │  │             │  │  - file search   │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Plugin System                           │   │
│  │  - Schema validation                                │   │
│  │  - Dynamic loading                                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ TaskEvent
     ┌────────────────────┼────────────────────┐
     │                    │                    │
┌────┴────┐         ┌─────┴─────┐       ┌─────┴─────┐
│   Jira   │         │  Telegram │       │   Slack   │
│  Plugin  │         │  Plugin   │       │  Plugin   │
└──────────┘         └───────────┘       └───────────┘
```

## Packages

This is a **pnpm monorepo** with the following packages:

| Package | Description |
|---------|-------------|
| `agent-detective` | Main application |
| `@agent-detective/types` | Shared TypeScript types |
| `@agent-detective/local-repos-plugin` | Local repository configuration and discovery |
| `@agent-detective/jira-adapter` | Jira webhook adapter |

### @agent-detective/types

All shared types are defined in `packages/types/src/index.ts`. This package is:

- Published to npm as `@agent-detective/types`
- Used by internal packages via pnpm workspace resolution
- Available to external plugins via `npm install @agent-detective/types`

## Plugins

Plugins are npm packages that extend agent-detective's capabilities. Each plugin:
- Exports a `register(app, context)` function
- Defines its configuration schema
- Is independently versioned and installable

**For plugin development, see [docs/plugins.md](plugins.md)** - a comprehensive guide with examples for webhook, interactive, command, and polling plugins.

### Official Plugins

- `@agent-detective/local-repos-plugin` - Local repository configuration with tech stack detection
- `@agent-detective/jira-adapter` - Jira webhook integration

### Configuration

Plugins are configured in `config/default.json`:

```json
{
  "port": 3001,
  "agent": "opencode",
  "repoContext": {
    "gitLogMaxCommits": 50,
    "searchPatterns": ["*.js", "*.ts", "*.py"]
  },
  "plugins": [
    {
      "package": "@agent-detective/local-repos-plugin",
      "options": {
        "repos": [
          {
            "name": "my-project",
            "path": "/path/to/your/project"
          }
        ],
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
          "fallbackOnNoMatch": "ask-agent"
        }
      }
    }
  ]
}
```

### Creating a Plugin

```typescript
// my-adapter/src/index.ts
import type { Plugin, PluginContext } from '@agent-detective/types';

const myPlugin: Plugin = {
  name: '@myorg/my-adapter',
  version: '1.0.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      webhookPath: { type: 'string', default: '/plugins/{plugin-name}/webhook' },
    },
    required: []
  },

  register(app, context: PluginContext) {
    const { config, agentRunner, localRepos, buildRepoContext, formatRepoContextForPrompt, logger } = context;
    
    app.post(config.webhookPath as string, async (req, res) => {
      const taskEvent = normalizePayload(req.body);
      // Process task...
    });
  }
};

export default myPlugin;
```

## TaskEvent Interface

All plugins produce a normalized `TaskEvent`:

```typescript
{
  id: string,              // Unique task ID
  type: 'incident' | 'question' | 'command',
  source: string,          // Plugin name

  message: string,         // Original text to process

  context: {
    repoPath: string | null,   // Repository to analyze
    threadId: string | null,   // Session ID
    cwd: string,
  },

  replyTo: {
    type: 'issue' | 'channel' | 'user',
    id: string,
  },

  metadata: Record<string, unknown>  // Source-specific data
}
```

## Development

See [docs/development.md](development.md)

## Migration to TypeScript

See [docs/migration.md](migration.md)