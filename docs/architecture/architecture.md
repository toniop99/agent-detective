---
title: Architecture
description: System architecture overview, plugin model, type system, and component diagram.
sidebar:
  order: 1
---

# Architecture

## Design Principles

1. **Source-agnostic core**: The agent runner, queue, and repo-context modules know nothing about where events come from. They operate purely on `TaskEvent` objects.

2. **Plugins extend functionality**: Each adapter (Jira, Telegram, Slack) is a plugin that:
   - Translates native format into `TaskEvent`
   - Handles sending replies back to the source
   - Defines its own configuration schema

3. **Shared task queue**: Events are queued by their `id` to prevent parallel execution on the same task. This works across all plugin sources.

4. **Plugin discovery**: Plugins are declared explicitly in `config/default.json` under `plugins[]`.

For **hexagonal-style layering** inside first-party plugins (presentation / application / domain / infrastructure), see [architecture-layering.md](architecture-layering.md) and [ADR 0001](adr/0001-layering-and-plugin-boundaries.md).

## Type System

All shared types are defined in `@agent-detective/types` (`packages/types/src/index.ts`) — a host-internal, type-only package. Plugin authors do **not** import it directly; the public surface is `@agent-detective/sdk`, which re-exports every plugin-facing type:

```typescript
import type { Plugin, PluginContext, TaskEvent, AgentRunner } from '@agent-detective/sdk';
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
import type { Plugin, PluginContext } from '@agent-detective/sdk';

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
  
  register(scope, context: PluginContext) {
    // scope: encapsulated Fastify instance under /plugins/{sanitized-name}
    // context: {
    //   agentRunner: AgentRunner,
    //   config: Record<string, unknown>,
    //   logger: Logger,
    //   registerService: (name, service) => void,
    //   getService: (name) => T
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
   e. Call register(scope, context) under the plugin's Fastify scope
   f. If error: log warning, continue with next
3. Start Fastify server
```

## Error Handling

- Plugin loading errors are caught and logged as warnings
- Server continues running even if some plugins fail to load
- Individual task processing errors are isolated per queue

## Component Diagram

```
                              ┌──────────────────┐
                              │   Fastify Server  │
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
7.   Agent runner executes prompt against the configured shell agent (opencode, claude, cursor, etc.)
     │
8.   onFinalResponse(commentText) {
        │
9.     Jira client.addComment('PROJ-123', commentText)
     }
   })
```

## Repo Matching Logic

Repository matching is **deterministic and label-only**. There is no
agent-driven discovery path.

### local-repos-plugin

Manages repository configuration with:
- Repositories defined in `config/default.json` under `plugins[].options.repos`
- Automatic validation of repository paths on startup
- Tech stack detection from file patterns (package.json, requirements.txt, etc.)
- Summary generation from README files or recent commits
- Exposes a **`RepoMatcher`** service under the `REPO_MATCHER_SERVICE` key
  (`@agent-detective/types`) with three methods:
  - `matchByLabels(labels)` — case-insensitive first-match against repo names
    (label-order).
  - `matchAllByLabels(labels)` — every match, returned in configured-repo
    order for stable multi-repo fan-out.
  - `listConfiguredLabels()` — repo names to show users when no label matches.

### jira-adapter Matching Flow

For Jira incidents, the adapter is a thin orchestrator on top of `RepoMatcher`:

1. **On `jira:issue_created`**: call `matchAllByLabels(issue.fields.labels)`.
   - One or more matches → emit one `TASK_CREATED` **per matched repo**
     (capped by `maxReposPerIssue`, default 5). Each task carries
     `context.repoPath`, `context.cwd`, and `metadata.matchedRepo`; task ids
     are `<ISSUE-KEY>:<repo-name>` so parallel runs don't collide in the
     queue. When more than one repo runs — or any repo is skipped by the cap
     — a single acknowledgment comment summarizes the fan-out. Result
     comments are prefixed with `## Analysis for \`<repo-name>\``.
   - No match → post a single Markdown comment listing
     `listConfiguredLabels()` via the missing-labels handler, then stop. No
     task is emitted.
2. **On `jira:comment_created`**: the adapter reads the comment body and
   runs the match again **only** when:
   - the body contains `retryTriggerPhrase` (case-insensitive substring,
     default `#agent-detective analyze`), and
   - the comment isn't adapter-authored (detected primarily by a visible
     *"Posted by agent-detective · ad-v1"* footer the adapter stamps on
     every comment it posts, with an optional
     `jiraUser.accountId` / `jiraUser.email` fallback, a per-issue
     60-second reminder rate-limit, and — for non-comment-triggered
     paths — a 10-minute per-`(issue, repo)` analysis cooldown as
     additional loop-safety nets).

   If both gates pass and there's a match, the adapter fans out identically
   to the `issue_created` path. No match → the reminder is posted again
   (the user explicitly asked). This replaces the previous
   `jira:issue_updated` changelog-based retry, so arbitrary field edits no
   longer trigger any work.
3. **On `jira:issue_updated` and everything else**: the adapter ignores the
   event. Configure `webhookBehavior.events."jira:issue_updated".action` to
   `"acknowledge"` only if you want a notification comment on every edit.
   The payload-shape classifier explicitly infers `issue_updated` (not
   `issue_created`) whenever the incoming payload carries any changelog
   activity — top-level `items`, `{{issue}}.changelog.histories`, or
   `changelog.total > 0` — which is what prevents adapter result comments
   from being mis-routed back into `analyze` when Jira Automation echoes
   them as bare-issue payloads.

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
        "webhookBehavior": {
          "defaults": { "action": "ignore" },
          "events": {
            "jira:issue_created": { "action": "analyze" },
            "jira:comment_created": { "action": "analyze" }
          }
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
├── sdk/                          # @agent-detective/sdk (defineRoute, registerRoutes, zodToPluginSchema)
│   ├── src/
│   └── package.json
│
├── process-utils/               # Shared process utilities (exec, pty)
│   ├── src/index.ts            # Process execution helpers
│   └── package.json
│
├── local-repos-plugin/          # Repository configuration plugin
│   ├── src/
│   │   ├── index.ts            # Plugin entry point
│   │   ├── types.ts            # Config interfaces
│   │   ├── validate.ts         # Path validation
│   │   ├── summary-generator.ts
│   │   ├── repo-context/       # Git log and context building
│   │   └── tech-stack-detector.ts
│   └── package.json
│
├── jira-adapter/               # Official Jira plugin
│   ├── src/
│   │   ├── index.ts                 # Plugin entry point
│   │   ├── types.ts                 # Config interfaces & types
│   │   ├── normalizer.ts            # Jira payload → TaskEvent
│   │   ├── webhook-handler.ts       # Main webhook router
│   │   ├── comment-trigger.ts       # Comment-triggered retry: marker, phrase match, own-comment filter
│   │   ├── handlers/                # Modular action handlers
│   │   │   ├── index.ts             # Handler router (label-match + comment retry orchestration)
│   │   │   ├── acknowledge-handler.ts
│   │   │   ├── missing-labels-handler.ts
│   │   │   └── ignore-handler.ts
│   │   └── mock-jira-client.ts
│   └── package.json
│
└── observability/              # Logging, metrics, tracing, health
    ├── src/
    │   ├── config.ts          # Configuration
    │   ├── logger.ts          # Structured logging
    │   ├── metrics.ts         # Prometheus metrics
    │   ├── tracing.ts         # Distributed tracing
    │   ├── health.ts          # Health checks
    │   ├── middleware.ts      # HTTP middleware
    │   └── index.ts           # Main export
    └── package.json
```