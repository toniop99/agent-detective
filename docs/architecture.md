# Architecture

## Design Principles

1. **Source-agnostic core**: The agent runner, queue, and repo-context modules know nothing about where events come from. They operate purely on `TaskEvent` objects.

2. **Plugins extend functionality**: Each adapter (Jira, Telegram, Slack) is a plugin that:
   - Translates native format into `TaskEvent`
   - Handles sending replies back to the source
   - Defines its own configuration schema

3. **Shared task queue**: Events are queued by their `id` to prevent parallel execution on the same task. This works across all plugin sources.

4. **Plugin discovery**: Plugins are declared explicitly in `config/default.json` under `plugins[]`.

## Type System

All shared types are defined in `@agent-detective/types` package (`packages/types/src/index.ts`).

Plugin developers should import types from `@agent-detective/types`:

```typescript
import type { Plugin, PluginContext, TaskEvent, AgentRunner } from '@agent-detective/types';
```

### Core Types

| Type | Description |
|------|-------------|
| `TaskEvent` | Normalized event from any plugin source |
| `Plugin` | Plugin interface definition |
| `PluginContext` | Context injected into plugins |
| `AgentRunner` | Interface for running AI agents |
| `LocalReposContext` | Repository configuration and access |

## Plugin Interface

```typescript
import type { Plugin, PluginContext } from '@agent-detective/types';

const plugin: Plugin = {
  name: '@agent-detective/plugin-name',
  version: '1.0.0',
  schemaVersion: '1.0',        // Must be '1.0'
  
  schema: {                      // JSON Schema for config validation
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      webhookPath: { type: 'string', default: '/plugins/{plugin-name}/webhook' },
    },
    required: []
  },
  
  register(app, context: PluginContext) {
    // app: Express app instance
    // context: {
    //   agentRunner: AgentRunner,
    //   localRepos: LocalReposContext,     // from local-repos-plugin
    //   buildRepoContext: function,        // from local-repos-plugin
    //   formatRepoContextForPrompt: function,
    //   config: Record<string, unknown>,
    //   logger: Logger
    // }
  }
};

export default plugin;
```

## Plugin Loading Flow

```
1. Load config from config/default.json
2. For each plugin in config.plugins[]:
   a. Import plugin package (npm or local)
   b. Validate plugin schema (name, version, register)
   c. Validate plugin config against schema
   d. Merge defaults from schema
   e. Call register(app, context)
   f. If error: log warning, continue with next
3. Start Express server
```

## Error Handling

- Plugin loading errors are caught and logged as warnings
- Server continues running even if some plugins fail to load
- Individual task processing errors are isolated per queue

## Component Diagram

```
                              ┌──────────────────┐
                              │   Express Server  │
                               │ /plugins/agent-detective-:source │
                              └────────┬─────────┘
                                       │
                    ┌────────────────┼────────────────┐
                    │                 │                 │
            ┌───────┴───────┐ ┌───────┴───────┐ ┌───────┴───────┐
            │Jira Adapter   │ │Telegram Adapter│ │ Slack Adapter │
            │(Official Plugin)│ │ (Future)      │ │ (Future)      │
            └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                      │
                                      ▼
                             ┌────────────────┐
                             │  TaskEvent {}  │
                             └───────┬────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
            │    Queue    │  │Agent Runner │  │ Repo Context│
            │ (by taskId) │  │             │  │ - git log  │
            │             │  │             │  │ - search   │
            └─────────────┘  └──────┬──────┘  └─────────────┘
                                    │
                                    ▼
                            ┌────────────────┐
                            │  ReplyTo {}     │
                            └───────┬────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   │                │                │
                   ▼                ▼                ▼
           ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
           │Jira Client  │  │Telegram Client│ │Slack Client │
           │(addComment) │  │(sendMessage) │  │ (chatPost) │
           └─────────────┘  └─────────────┘  └─────────────┘
```

## Flow: Jira Incident

```
1. Jira sends POST /plugins/agent-detective-jira-adapter/webhook/jira with issue_created event
         │
2. Jira plugin webhook handler receives payload
         │
3. Normalizer creates TaskEvent:
   {
     type: 'incident',
     source: '@agent-detective/jira-adapter',
     message: issue.description,
     context: { repoPath: lookup mapping, threadId: null },
     replyTo: { type: 'issue', id: 'PROJ-123' }
   }
         │
4. Queue.enqueue('PROJ-123', async () => {
     │
5.   Repo context builder (from context):
     - gitLog(repoPath, { maxCommits: 50 })
     - fileSearch(repoPath, { patterns: errorPatterns })
     │
6.   Prompt builder combines: issue info + repo context
     │
7.   Agent runner executes prompt against opencode/codex
     │
8.   onFinalResponse(commentText) {
        │
9.     Jira client.addComment('PROJ-123', commentText)
     }
   })
```

## Repo Discovery Logic

Repository discovery is handled by `local-repos-plugin` and `jira-adapter`:

### local-repos-plugin

Manages repository configuration with:
- Repositories defined in `config/default.json` under `plugins[].options.repos`
- Automatic validation of repository paths on startup
- Tech stack detection from file patterns (package.json, requirements.txt, etc.)
- Summary generation from README files or recent commits

### jira-adapter Discovery Flow

For Jira incidents, the adapter attempts to find the relevant repository:

1. **Direct Match**: Check if any Jira label matches a configured repo name
2. **Agent-Assisted Discovery**: If no direct match and `discovery.useAgentForDiscovery: true`:
   - Build context with all configured repos (tech stack + summary)
   - Ask the agent to determine which repo is most relevant
3. **Fallback**: Based on `discovery.fallbackOnNoMatch`:
   - `ask-agent`: Present all repos to agent for selection
   - `use-first`: Use the first configured repo
   - `skip-analysis`: Process without repo context

Configuration in `config/default.json`:
```json
{
  "plugins": [
    {
      "package": "@agent-detective/local-repos-plugin",
      "options": {
        "repos": [
          { "name": "my-project", "path": "/path/to/project" }
        ]
      }
    },
    {
      "package": "@agent-detective/jira-adapter",
      "options": {
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

## Mock Mode

Each adapter plugin can run in mock mode for testing. When enabled:
- jira-adapter: Uses mock Jira client instead of real API calls
- Mock clients store data in memory for deterministic tests

## Package Structure

```
packages/
├── types/                        # @agent-detective/types
│   ├── src/index.ts             # All shared type definitions
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   └── dist/                    # Built output for npm
│
├── local-repos-plugin/          # Repository configuration plugin
│   ├── src/
│   │   ├── index.ts            # Plugin entry point
│   │   ├── types.ts            # Config interfaces
│   │   ├── validate.ts         # Path validation
│   │   └── tech-stack-detector.ts
│   ├── package.json
│   └── dist/
│
└── jira-adapter/               # Official Jira plugin
    ├── src/
    │   ├── index.ts            # Plugin entry point
    │   ├── types.ts            # Config interfaces
    │   ├── normalizer.ts       # Jira payload → TaskEvent
    │   ├── webhook-handler.ts
    │   ├── discovery.ts        # Repo discovery logic
    │   └── mock-jira-client.ts
    ├── test/
    │   └── normalizer.test.ts
    ├── package.json
    └── dist/                   # Built output for npm
```