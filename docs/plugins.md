# Plugin Development Guide

Plugins extend agent-detective to connect any event source (Jira, Telegram, Slack, etc.). This guide covers everything you need to build a plugin.

**Bundled plugin options (Zod → JSON Schema):** after changing `options-schema.ts` in `@agent-detective/jira-adapter` or `@agent-detective/local-repos-plugin`, run `pnpm docs:plugins` and commit [generated/plugin-options.md](generated/plugin-options.md). See [configuration.md](configuration.md).

## Table of Contents

1. [Plugin Anatomy](#1-plugin-anatomy)
2. [Core Context Reference](#2-core-context-reference)
2b. [Task queue (`TaskQueue`)](#task-queue-taskqueue)
3. [Schema System](#3-schema-system)
4. [TaskEvent Interface](#4-taskevent-interface)
5. [Example: Jira-Style Webhook Plugin](#5-example-jira-style-webhook-plugin)
6. [Example: Interactive Question Plugin (Telegram-Style)](#6-example-interactive-question-plugin-telegram-style)
7. [Example: Slash Command Plugin](#7-example-slash-command-plugin)
8. [Example: Polling Plugin](#8-example-polling-plugin)
9. [Publishing a Plugin as an npm Package](#9-publishing-a-plugin-as-an-npm-package)
10. [Core API Reference](#10-core-api-reference)
11. [Error Handling](#11-error-handling)
12. [Testing Patterns](#12-testing-patterns)
13. [Third-Party Plugins](#13-third-party-plugins)
14. [Official Bundled Plugins](#14-official-bundled-plugins)

---

## 1. Plugin Anatomy

A plugin is an ES module that exports a plain object with the following structure:

```typescript
// packages/my-adapter/src/index.ts
import type { Plugin, PluginContext } from '@agent-detective/types';

const myPlugin: Plugin = {
  name: '@myorg/my-adapter',   // unique package name
  version: '1.0.0',                     // semver version
  schemaVersion: '1.0',                 // must be '1.0'

  schema: {                              // JSON Schema for config validation
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
    webhookPath: { type: 'string', default: '/webhook/my-plugin' },
    },
    required: []
  },

  register(app, context: PluginContext) {
    // app: Express app instance
    // context: core dependencies (see Section 2)
  }
};

export default myPlugin;
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique plugin identifier (e.g., `@agent-detective/jira-adapter`) |
| `version` | `string` | Semver version (e.g., `1.0.0`) |
| `register` | `function` | Called on load with `(app, context)` |
| `schemaVersion` | `string` | Must be `'1.0'` |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `schema` | `object` | JSON Schema for config validation (see Section 3) |

---

## 2. Core Context Reference

The `register` function receives a `context` object with all core services:

```typescript
register(app, context: PluginContext) {
  const {
    agentRunner,              // run AI agents
    config,                   // validated plugin config with defaults applied
    logger,                   // logger with plugin prefix
  } = context;

  // Accessing repository context from local-repos-plugin
  try {
    const localReposService = context.getService<LocalReposService>('@agent-detective/local-repos-plugin');
    const localRepos = localReposService.localRepos;
    // ...
  } catch (err) {
    logger.warn('Local repos service not available');
  }
}
```

### Available Context Members

| Member | Type | Description |
|--------|------|-------------|
| `agentRunner` | `AgentRunner` | Executes AI agent prompts (see Section 10) |
| `config` | `object` | Plugin config validated against schema, with defaults merged |
| `logger` | `Logger` | Logger with `.info()`, `.warn()`, `.error()` |
| `registerService<T>(name, service)` | `function` | Register a service for other plugins to consume |
| `getService<T>(name)` | `function` | Get a registered service by name with type safety |
| `registerCapability(name)` | `function` | Register a capability provided by this plugin |
| `hasCapability(name)` | `function` | Check if a capability is registered |
| `registerAgent(agent)` | `function` | Register a new AI agent provider |
| `registerTaskQueue(queue)` | `function` | Replace the global `TaskQueue` backend (same contract as `enqueue`; use for Redis/SQLite workers) |
| `enqueue` | `function` | Enqueue tasks to be executed sequentially per key (delegates to the active queue) |

### Task queue (`TaskQueue`)

The host builds the plugin system **before** the orchestrator and HTTP API, and passes **`createPluginSystem(...).enqueue`** into those components so every code path shares one queue.

- **`createPluginSystem({ agentRunner, events, logger?, taskQueue? })`**: if `taskQueue` is omitted, the core uses an in-memory `TaskQueue` (same behavior as before). Pass `taskQueue` from tests or from a custom bootstrap if you need a specific initial backend.
- **Plugins** call `context.registerTaskQueue(queue)` to replace the backend at runtime (for example a Redis-backed package loaded via `config.plugins`). The previous queue’s optional `shutdown()` is invoked (async errors are logged).
- **`EnqueueFn` is still in-process**: `enqueue(key, fn)` runs the given `fn` in this Node process. Surviving process restarts requires a plugin that persists **serialized** work and replays it (a different design than only swapping `TaskQueue`).

There is **no** `enqueue` option on `createPluginSystem`; use `taskQueue` or the default memory queue.

### Type-Safe Service Registry

Plugins can share functionality by registering services. This is preferred over accessing the `plugins` dictionary directly as it provides better type safety and error handling.

#### Providing a Service

```typescript
// In your plugin's index.ts
export interface MyService {
  doSomething(): string;
}

const myPlugin: Plugin = {
  name: 'my-provider-plugin',
  // ...
  register(app, context) {
    const service: MyService = {
      doSomething: () => 'Hello from service!'
    };
    
    context.registerService<MyService>('my-service', service);
  }
};
```

#### Consuming a Service

```typescript
// In the consumer plugin
import type { MyService } from 'my-provider-plugin';

const consumerPlugin: Plugin = {
  name: 'my-consumer-plugin',
  dependsOn: ['my-provider-plugin'],
  register(app, context) {
    // getService will throw if the service is not found
    const myService = context.getService<MyService>('my-service');
    
    console.log(myService.doSomething());
  }
};
```

### LocalReposContext

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
  description?: string;
  techStack: string[];
  summary: string;
}
```

---

## 3. Schema System

Plugins define their configuration schema using a subset of JSON Schema. The core validates the config against the schema when the plugin loads.

### Supported Property Types

```typescript
schema: {
  type: 'object',
  properties: {
    // String values
    webhookPath: { type: 'string', default: '/webhook/my' },
    apiKey: { type: 'string', default: '' },

    // Boolean values
    enabled: { type: 'boolean', default: true },
    mockMode: { type: 'boolean', default: false },

    // Number values
    timeoutMs: { type: 'number', default: 30000 },
    maxRetries: { type: 'number', default: 3 },

    // Array values
    allowedChannels: { type: 'array', default: [] },

    // Object values
    nestedConfig: { type: 'object', default: {} },
  },
  required: ['webhookPath']   // fields that must be present
}
```

### How Defaults Work

The plugin system automatically merges defaults from the schema into `config` before calling `register`. You don't need to apply defaults manually:

```typescript
// schema defines: webhookPath: { type: 'string', default: '/webhook/my' }
// config in default.json: { package: 'my-adapter', options: {} }

// In register, config.webhookPath will be '/webhook/my' even though
// the user didn't specify it in default.json
register(app, { config }) {
  console.log(config.webhookPath); // '/webhook/my' - default was applied
}
```

### Schema Version

Include `schemaVersion: '1.0'` in your plugin. This allows future schema versions without breaking existing plugins.

```typescript
export default {
  name: '@agent-detective/my-adapter',
  version: '1.0.0',
  schemaVersion: '1.0',   // required - must be '1.0'
  // ...
};
```

---

## 4. TaskEvent Interface

All plugins produce a normalized `TaskEvent` object that the core processes identically regardless of source.

```typescript
const taskEvent: TaskEvent = {
  id: 'PROJ-123',                    // Unique task ID (e.g., Jira issue key)
  type: 'incident',                  // 'incident' | 'question' | 'command'
  source: '@agent-detective/my-adapter', // Plugin name

  message: 'User reported login failure...', // Original text to process

  context: {
    repoPath: '/path/to/project', // Repository path (null = no repo access)
    threadId: null,                     // Session ID (null = new session)
    cwd: process.cwd(),                 // Working directory
  },

  replyTo: {
    type: 'issue',                      // 'issue' | 'channel' | 'user'
    id: 'PROJ-123',                     // Target identifier
  },

  metadata: {                          // Source-specific data
    labels: ['backend', 'auth'],
    issueType: 'Bug',
    reporter: 'john@example.com',
  }
};
```

### Event Types

| Type | Description | Typical Reply |
|------|-------------|---------------|
| `incident` | Something broke, needs investigation | Root cause analysis comment |
| `question` | User asking a question | Conversational response |
| `command` | Bot command (e.g., `/analyze`) | Command output |

### Reply Targets

| Type | Description |
|------|-------------|
| `issue` | Jira issue, GitHub PR, etc. |
| `channel` | Chat channel (Telegram group, Slack channel) |
| `user` | Direct message to a user |

---

## 5. Example: Jira-Style Webhook Plugin

This is the most common plugin pattern. The plugin receives HTTP POST webhooks, normalizes them into `TaskEvent`, and posts analysis comments back to the source.

### Project Structure

```
packages/my-jira/
├── src/
│   ├── index.ts          # Plugin entry point
│   ├── normalizer.ts     # Payload → TaskEvent
│   └── jira-client.ts    # Jira API client
├── test/
│   └── normalizer.test.ts
├── package.json
└── tsconfig.json
```

### package.json

```json
{
  "name": "@myorg/agent-detective-jira",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "tsx --test"
  },
  "dependencies": {
    "@agent-detective/types": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  }
}
```

### Webhook + services pattern (sketch)

Use **`context.getService`** to obtain the local-repos service (or the **`REPO_MATCHER_SERVICE`** matcher's `matchByLabels` when you only need a path). Use **`context.enqueue`** for serialized work. Plugin routes are normally registered via `@Controller` (see [plugin-development.md](plugin-development.md)); the effective URL is under **`/plugins/{sanitized-name}/`**.

The official **jira-adapter** implements the full Jira + fan-out flow — treat it as the reference, not the stale snippet below. This sketch shows the *correct* `PluginContext` surface:

```typescript
// Sketch — not a full drop-in. See packages/jira-adapter for production code.
import type { Plugin, PluginContext, TaskEvent, RepoMatcher } from '@agent-detective/types';
import { REPO_MATCHER_SERVICE } from '@agent-detective/types';
import type { LocalReposService } from '@agent-detective/local-repos-plugin';

type JiraClient = { addComment(issueKey: string, text: string): Promise<void> };

const plugin: Plugin = {
  name: '@myorg/my-jira',
  version: '0.1.0',
  schemaVersion: '1.0',
  dependsOn: ['@agent-detective/local-repos-plugin'],
  schema: { type: 'object', properties: { enabled: { type: 'boolean', default: true } }, required: [] },

  register(_app, context: PluginContext) {
    const { config, agentRunner, enqueue, logger } = context;
    if (!config.enabled) return;

    const matcher = context.getService<RepoMatcher>(REPO_MATCHER_SERVICE);
    let local: LocalReposService;
    try {
      local = context.getService<LocalReposService>('@agent-detective/local-repos-plugin');
    } catch {
      logger.error('local-repos-plugin is required for this example');
      return;
    }
    const jira = makeJiraClient();

    _app.post('/webhook/jira', async (req, res) => {
      const task = normalizePayload(req.body) as TaskEvent;
      const labels = (task.metadata?.labels as string[] | undefined) ?? [];
      const m = matcher.matchByLabels(labels);
      task.context = { ...task.context, repoPath: m?.path ?? null };

      void enqueue(task.id, async () => {
        let ctxText = '';
        if (task.context.repoPath) {
          const built = await local.buildRepoContext(task.context.repoPath, { maxCommits: 50 });
          ctxText = local.formatRepoContextForPrompt(built);
        }
        await agentRunner.runAgentForChat(task.id, buildPrompt(task, ctxText), {
          onFinal: async (t) => {
            await jira.addComment(task.replyTo.id, t);
          },
        });
      });
      res.json({ status: 'queued' });
    });
  },
};

function buildPrompt(task: TaskEvent, repo: string) {
  return [task.message, repo ? `### Repository context\n${repo}` : ''].filter(Boolean).join('\n\n');
}
function normalizePayload(body: unknown): TaskEvent {
  void body;
  throw new Error('See your normalizer / packages/jira-adapter');
}
function makeJiraClient(): JiraClient {
  return { async addComment() {} };
}

export default plugin;
```

### Minimal Normalizer

```typescript
// packages/my-jira/src/normalizer.ts
import type { TaskEvent } from '@agent-detective/types';

export function normalizePayload(payload: JiraPayload): TaskEvent {
  const issue = payload.issue || payload;

  return {
    id: issue.key || String(Date.now()),
    type: 'incident',
    source: '@myorg/agent-detective-jira',
    message: buildIncidentMessage(issue),
    context: {
      repoPath: null,
      threadId: null,
      cwd: process.cwd(),
    },
    replyTo: {
      type: 'issue',
      id: issue.key,
    },
    metadata: {
      labels: issue.fields?.labels || [],
      projectKey: issue.fields?.project?.key || '',
      issueType: issue.fields?.issuetype?.name || 'Task',
      reporter: issue.fields?.reporter?.displayName || 'unknown',
    },
  };
}

function buildIncidentMessage(issue: JiraIssue): string {
  const desc = issue.fields?.description || '';
  return `## Incident: ${issue.fields?.summary || 'No title'}\n\n### Description\n${desc}`;
}
```

---

## 6. Example: Interactive Question Plugin (Telegram-Style)

This pattern handles conversational messages where a user asks a question. The plugin maintains conversation threads via `threadId`, and supports streaming progress updates.

### Key Differences from Webhook Plugins

- `type: 'question'` instead of `incident`
- `replyTo.type: 'user'` or `'channel'`
- Uses `threadId` to continue conversations
- Supports streaming progress via `onProgress` callback
- Agent can respond without repo context (optional analysis)

### Full Implementation

```typescript
// packages/my-telegram/src/index.ts
import type { Plugin, PluginContext, TaskEvent } from '@agent-detective/types';

const plugin: Plugin = {
  name: '@myorg/agent-detective-telegram',
  version: '0.1.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      botToken: { type: 'string', default: '' },
      allowedChannels: { type: 'array', default: [] },
      defaultRepoPath: { type: 'string', default: null },
    },
    required: ['botToken'],
  },

  register(app, context: PluginContext) {
    const { config, agentRunner, enqueue, logger } = context;

    if (!config.enabled) return;

    // Optional: resolve a default repo from local-repos (or another service you register).
    // There is no context.repoMapping — use getService<RepoMatcher>(REPO_MATCHER_SERVICE) or
    // getService<LocalReposService>('@agent-detective/local-repos-plugin') and your own rules.

    const telegram = createTelegramBot(config.botToken as string);

    telegram.on('message', async (msg) => {
      const { chatId, text, messageId } = msg;

      const defaultPath = (config.defaultRepoPath as string) || null;
      // There is no context.repoMapping. Resolve paths via your own config,
      // or getService<RepoMatcher>(REPO_MATCHER_SERVICE) / LocalReposService.
      const repoPath = defaultPath;

      const taskEvent: TaskEvent = {
        id: `${chatId}:${messageId}`,
        type: 'question',
        source: '@myorg/agent-detective-telegram',
        message: text.replace(/proj:\S+\s*/, '').trim(),
        context: {
          repoPath,
          threadId: String(chatId),
          cwd: process.cwd(),
        },
        replyTo: {
          type: 'user',
          id: String(chatId),
        },
        metadata: {
          messageId,
          chatId,
          username: msg.from?.username,
        },
      };

      void enqueue(taskEvent.context.threadId ?? 'default', async () => {
        const out = await agentRunner.runAgentForChat(taskEvent.id, taskEvent.message, {
          contextKey: taskEvent.context.threadId ?? taskEvent.id,
          repoPath: taskEvent.context.repoPath,
        });
        logger.info('Reply', { out: out.slice(0, 200) });
        // await telegram.sendMessage(chatId, out);
      });
    });

    logger.info('Telegram adapter registered');
  },
};

export default plugin;
```

---

## 7. Example: Slash Command Plugin

Handles bot commands like `/analyze`, `/status`, `/help`. Commands are typically prefixed and parsed from regular messages.

```typescript
// packages/my-slash-command/src/index.ts
import type { Plugin, PluginContext, TaskEvent } from '@agent-detective/types';

const plugin: Plugin = {
  name: '@myorg/agent-detective-slack',
  version: '0.1.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      webhookPath: { type: 'string', default: '/webhook/slack' },
      signingSecret: { type: 'string', default: '' },
    },
    required: ['webhookPath'],
  },

  register(app, context: PluginContext) {
    const { config, agentRunner, logger } = context;

    if (!config.enabled) return;

    app.post(config.webhookPath as string, async (req, res) => {
      res.json({ status: 'ok' });

      const { command, text, user_id, channel_id } = req.body;

      if (command === '/analyze') {
        await handleAnalyze({ command, text, user_id, channel_id }, { config, agentRunner, logger });
      } else if (command === '/status') {
        await handleStatus({ command, user_id, channel_id }, { config, agentRunner, logger });
      } else {
        logger.warn(`Unknown command: ${command}`);
      }
    });

    logger.info('Slash command adapter registered');
  },
};

export default plugin;
```

---

## 8. Example: Polling Plugin

Polls an external API periodically instead of receiving webhooks. Useful for checking status, monitoring, or periodic reporting.

```typescript
// packages/my-poller/src/index.ts
import type { Plugin, PluginContext } from '@agent-detective/types';

const plugin: Plugin = {
  name: '@myorg/agent-detective-poller',
  version: '0.1.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      pollIntervalMs: { type: 'number', default: 60000 },
      apiEndpoint: { type: 'string', default: '' },
      apiKey: { type: 'string', default: '' },
    },
    required: ['apiEndpoint'],
  },

  register(app, context: PluginContext) {
    const { config, agentRunner, logger } = context;

    if (!config.enabled) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    app.post('/control/poller/start', (req, res) => {
      startPolling();
      res.json({ status: 'started' });
    });

    app.post('/control/poller/stop', (req, res) => {
      stopPolling();
      res.json({ status: 'stopped' });
    });

    async function poll() {
      try {
        const events = await fetchExternalEvents(config);
        for (const rawEvent of events) {
          const taskEvent = normalizeEvent(rawEvent);
          await processTask(taskEvent, { config, agentRunner, logger });
        }
      } catch (err) {
        logger.error(`Polling error: ${(err as Error).message}`);
      }
    }

    function startPolling() {
      if (intervalId) return;
      logger.info(`Starting poller with interval ${config.pollIntervalMs}ms`);
      poll();
      intervalId = setInterval(poll, config.pollIntervalMs as number);
    }

    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info('Poller stopped');
      }
    }

    startPolling();
    process.on('SIGTERM', stopPolling);
  },
};

export default plugin;
```

---

## 9. Publishing a Plugin as an npm Package

### Option A: Local packages/ Directory

For development within the monorepo, put your plugin in `packages/`:

```
agent-detective/
├── packages/
│   ├── jira-adapter/           # Official
│   └── my-adapter/             # Your plugin
│       ├── package.json
│       ├── src/
│       │   └── index.ts
│       └── dist/               # Built output
```

### Option B: Separate npm Package

To publish your plugin as a standalone npm package:

**1. Create the plugin package structure:**

```
my-adapter/
├── src/
│   ├── index.ts               # Plugin entry point
│   └── normalizer.ts
├── test/
│   └── normalizer.test.ts
├── package.json
└── tsconfig.json
```

**2. `package.json`:**

```json
{
  "name": "@myorg/agent-detective-my-adapter",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "tsx --test"
  },
  "dependencies": {
    "@agent-detective/types": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  },
  "keywords": ["agent-detective", "plugin"]
}
```

**3. Publish to npm:**

```bash
cd my-adapter
pnpm install
pnpm run build
pnpm publish --access public
```

**4. Install in agent-detective:**

```bash
cd agent-detective
pnpm add @myorg/agent-detective-my-adapter
```

**5. Configure in `config/default.json`:**

```json
{
  "plugins": [
    {
      "package": "@myorg/agent-detective-my-adapter",
      "options": {
        "enabled": true,
        "webhookPath": "/webhook/my"
      }
    }
  ]
}
```

### Loading Priority

The plugin system tries to load plugins in this order:

1. If `package` starts with `./`, `../`, or `/` → treat as file path relative to project root
2. Try `import(packageName)` from node_modules
3. Try `import(packages/{name}/src/index.js)` where `@agent-detective/X` maps to `packages/X/src/index.js`

---

## 10. Core API Reference

### AgentRunner

Created by `createAgentRunner()` with shell execution utilities. Available in plugins via `context.agentRunner`.

#### `agentRunner.runAgentForChat(taskId, prompt, options)`

Runs an AI agent with a prompt.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskId` | `string` | Unique task identifier (used for queuing) |
| `prompt` | `string` | Full prompt to send to the agent |
| `options.contextKey` | `string` | Context key for conversation continuity (default: `taskId`) |
| `options.repoPath` | `string\|null` | Repository path for context |
| `options.cwd` | `string` | Working directory (default: `process.cwd()`) |
| `options.agentId` | `string` | Override agent (default: from config) |
| `options.onProgress` | `function` | Called with progress updates (streaming agents) |
| `options.onFinal` | `function` | Called with final response text |

**Returns:** `Promise<string>` - the agent's response text

**Example:**

```typescript
await agentRunner.runAgentForChat(taskEvent.id, fullPrompt, {
  contextKey: taskEvent.context.threadId,
  repoPath: taskEvent.context.repoPath,
  onProgress: (messages) => {
    for (const msg of messages) {
      sendMessage(userId, `Thinking: ${msg}`);
    }
  },
  onFinal: async (responseText) => {
    await jiraClient.addComment(issueId, responseText);
  },
});
```

#### `agentRunner.stopActiveRun(taskId, contextKey)`

Stops an active agent run.

**Returns:** `Promise<{ status: 'idle' | 'stopping' }>`

---

### `RepoMatcher` (service) and `local-repos` service

`PluginContext` does **not** include `repoMapping` or `buildRepoContext` directly.

- **`REPO_MATCHER_SERVICE`** — register/consume a `RepoMatcher` (`matchByLabels`, `matchAllByLabels`, `listConfiguredLabels`). The bundled **local-repos-plugin** provides the implementation; the **jira-adapter** consumes it for label → repo resolution.
- **`@agent-detective/local-repos-plugin`** service — a `LocalReposService` with `localRepos`, `buildRepoContext(repoPath, options?)`, and `formatRepoContextForPrompt`. `BuildRepoContextOptions` in `@agent-detective/types` only supports `{ maxCommits?: number }` (file search was removed; agents search the tree themselves).

```typescript
import { REPO_MATCHER_SERVICE } from '@agent-detective/types';
import type { RepoMatcher } from '@agent-detective/types';
import type { LocalReposService } from '@agent-detective/local-repos-plugin';

const matcher = context.getService<RepoMatcher>(REPO_MATCHER_SERVICE);
const m = matcher.matchByLabels(['my-repo-name']);

const local = context.getService<LocalReposService>('@agent-detective/local-repos-plugin');
if (m) {
  const built = await local.buildRepoContext(m.path, { maxCommits: 50 });
  const text = local.formatRepoContextForPrompt(built);
}
```

---

## 11. Error Handling

### Plugin Loading Errors

The plugin system catches errors during loading and logs them as warnings. The server continues running.

```typescript
try {
  plugin.register(app, pluginContext);
} catch (err) {
  logger.warn(`Failed to load plugin ${pluginName}: ${(err as Error).message}. Continuing...`);
  return null;
}
```

**Best Practice:** Use `config.enabled` to cleanly disable a plugin without errors:

```typescript
register(app, context: PluginContext) {
  if (!context.config.enabled) {
    context.logger.info('Plugin is disabled');
    return;
  }
  // normal setup
}
```

### Per-Task Error Isolation

Wrap each task in try-catch to prevent one failing task from affecting others:

```typescript
enqueueTask(taskId, async () => {
  try {
    await processTask(taskEvent, context);
  } catch (err) {
    logger.error(`Task ${taskId} failed: ${(err as Error).message}`);
  }
});
```

---

## 12. Testing Patterns

### `createPluginSystem` in unit tests

`createPluginSystem` requires **`events`** (an `EventBus`). Pass a no-op bus and a minimal `AgentRunner` (`registerAgent`, `listAgents`, `runAgentForChat`, `stopActiveRun`). Omit **`taskQueue`** to use the default in-memory queue, or pass a stub `{ enqueue }` to assert queue behavior. Use the **`enqueue`** property on the return value to run work the same way the production app does.

### Mock Clients

Create an in-memory mock client that stores data instead of making external API calls:

```typescript
// src/mock-jira-client.ts
export interface MockJiraClient {
  comments: Map<string, MockComment[]>;
  addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }>;
}

export function createMockJiraClient(): MockJiraClient {
  const comments = new Map<string, MockComment[]>();

  return {
    comments,
    async addComment(issueKey: string, commentText: string) {
      if (!comments.has(issueKey)) {
        comments.set(issueKey, []);
      }
      comments.get(issueKey)!.push({
        text: commentText,
        createdAt: new Date().toISOString(),
      });
      console.info(`[MOCK] Added comment to ${issueKey}`);
      return { success: true, issueKey };
    },
  };
}
```

### Testing with Fixtures

Store sample payloads as JSON fixtures:

```json
// test/fixtures/issue-created.json
{
  "issue": {
    "key": "PROJ-123",
    "fields": {
      "summary": "Login fails for users",
      "description": "Users cannot login after latest deployment",
      "labels": ["backend", "auth"],
      "project": { "key": "PROJ" },
      "issuetype": { "name": "Bug" }
    }
  }
}
```

### Plugin Unit Test Example

```typescript
// test/normalizer.test.ts
import { strict as assert } from 'assert';
import { normalizePayload } from '../src/normalizer.js';
import issueCreated from './fixtures/issue-created.json';

test('normalizePayload extracts correct fields', () => {
  const taskEvent = normalizePayload(issueCreated);

  assert.equal(taskEvent.id, 'PROJ-123');
  assert.equal(taskEvent.type, 'incident');
  assert.equal(taskEvent.source, '@myorg/agent-detective-jira');
  assert.ok(taskEvent.message.includes('Login fails'));
  assert.deepEqual(taskEvent.metadata.labels, ['backend', 'auth']);
  assert.equal(taskEvent.replyTo.type, 'issue');
  assert.equal(taskEvent.replyTo.id, 'PROJ-123');
});

test('mock client stores comments', () => {
  const mockClient = createMockJiraClient();

  mockClient.addComment('PROJ-123', 'Root cause analysis...');

  const comments = mockClient.comments.get('PROJ-123');
  assert.equal(comments?.length, 1);
  assert.ok(comments?.[0].text.includes('Root cause'));
});
```

---

## 13. Third-Party Plugins

### Installing Third-Party Plugins

Third-party plugins can be installed via volume mount in Docker:

```bash
# Plugin structure
plugins/
└── my-plugin/
    ├── index.js      # Main entry
    └── index.d.ts    # Type declarations
```

```bash
# Run with plugins
docker run -d -p 3001:3001 \
  -v $(pwd)/plugins:/app/plugins:ro \
  ghcr.io/toniop99/agent-detective:latest
```

### Enabling Third-Party Plugins

Add to `config/default.json`:

```json
{
  "plugins": [
    {
      "package": "/app/plugins/my-plugin",
      "options": {
        "enabled": true,
        "someOption": "value"
      }
    }
  ]
}
```

### Plugin Package Structure

Third-party plugins should follow this structure:

```
my-plugin/
├── package.json
├── dist/
│   ├── index.js
│   └── index.d.ts
└── README.md
```

For full plugin development guide, see [docs/plugin-development.md](plugin-development.md).

---

## 14. Official Bundled Plugins

The official Docker image includes these plugins:

### local-repos-plugin

Manages local repository configuration with validation, tech stack detection, and summary generation.

**Package:** `@agent-detective/local-repos-plugin`

**Can Disable:** Yes (`"enabled": false` in config)

**Configuration:**
```json
{
  "plugins": [
    {
      "package": "@agent-detective/local-repos-plugin",
      "options": {
        "enabled": true,
        "repos": [
          { "name": "backend", "path": "/repos/backend" }
        ]
      }
    }
  ]
}
```

### jira-adapter

Handles Jira webhooks and dispatches deterministic, label-based analysis via
the `RepoMatcher` service exposed by `local-repos-plugin`.

**Package:** `@agent-detective/jira-adapter`

**Can Disable:** Yes (`"enabled": false` in config)

#### Webhook Behavior Configuration

The `webhookBehavior` option lets you define what action to take for each Jira webhook event type:

```json
{
  "plugins": [
    {
      "package": "@agent-detective/jira-adapter",
      "options": {
        "enabled": true,
        "mockMode": false,
        "baseUrl": "https://your-domain.atlassian.net",
        "email": "bot@example.com",
        "apiToken": "your-api-token",
        "webhookBehavior": {
          "defaults": {
            "action": "ignore",
            "acknowledgmentMessage": "Thanks for the update! I will review this issue shortly."
          },
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

##### Actions

| Action | Description |
|--------|-------------|
| `analyze` | Match the issue's labels against configured repos; on matches, fan out one analysis per repo. On `issue_created` without a match, post a "please add a matching label and comment `<trigger>`" reminder. On `jira:comment_created`, run the match **only** when the comment body contains `retryTriggerPhrase` and wasn't authored by the adapter itself. No automatic retry on `issue_updated`. |
| `acknowledge` | Post a fixed acknowledgment comment (no matching, no analysis) |
| `ignore` | Log the event and skip processing |

##### Configuration Options

| Option | Description |
|--------|-------------|
| `webhookBehavior.defaults.action` | Default action for unhandled events |
| `webhookBehavior.defaults.acknowledgmentMessage` | Default message for `acknowledge` action |
| `webhookBehavior.events.{eventType}.action` | Action for a specific event type |
| `webhookBehavior.events.{eventType}.acknowledgmentMessage` | Override message for a specific event |
| `webhookBehavior.events.{eventType}.analysisPrompt` | Custom analysis prompt template |
| `analysisReadOnly` | When `true` (default), `analyze` tasks run with write/edit/shell tools denied |
| `missingLabelsMessage` | Markdown template posted when no label matches on `issue_created` or on a comment-triggered retry. Supports `{available_labels}`, `{issue_key}`, and `{trigger_phrase}` placeholders. |
| `maxReposPerIssue` | Safety cap on fan-out when an issue's labels match multiple repos. Default `5`; `0` disables the cap. Extra matches are logged and noted in the acknowledgment. |
| `retryTriggerPhrase` | Case-insensitive substring that, when found in a `jira:comment_created` body authored by a non-adapter user, kicks off a fresh label match. Default `#agent-detective analyze`. Pick something unlikely to appear in normal conversation — any matching comment runs analysis. |
| `jiraUser.accountId` / `jiraUser.email` | Optional identity of the Jira account the adapter posts as. Used together with the visible *"Posted by agent-detective"* footer marker to filter out adapter-authored comments so the retry flow can't loop. Comments from this account are ignored even if the marker is stripped. |

##### Supported Event Types

| Event Type | Default Action |
|-----------|---------------|
| `jira:issue_created` | `analyze` |
| `jira:comment_created` | `analyze` (gated: only runs when the comment contains `retryTriggerPhrase` and is not adapter-authored) |
| `jira:issue_updated` | `ignore` (falls to default) — no more changelog-based auto-retry |
| `jira:issue_deleted` | `ignore` (falls to default) |

#### Repository matching

Matching is **label-only** and **deterministic**. The Jira adapter consumes
the `RepoMatcher` service (`REPO_MATCHER_SERVICE` from
`@agent-detective/types`) which `local-repos-plugin` registers. The matcher
exposes two methods:

- `matchByLabels(labels) → MatchedRepo | null` — first match (label-order).
- `matchAllByLabels(labels) → MatchedRepo[]` — every match, returned in
  **configured-repo order** for stable fan-out.

On a match, the adapter emits one `TASK_CREATED` **per matched repo** with
`context.repoPath`, `context.cwd`, and `metadata.matchedRepo` pre-set so the
downstream analyzer has no selection work to do. Task ids are composite —
`<ISSUE-KEY>:<repo-name>` — so parallel fan-out runs don't collapse in the
orchestrator queue. Result comments carry a `## Analysis for \`<repo-name>\``
heading so readers can tell them apart on the ticket.

Retries are user-initiated via `jira:comment_created`: if a ticket was
created without a matching label, the adapter posts a reminder listing
every configured label plus the exact `retryTriggerPhrase` to include in a
follow-up comment. Posting a comment that contains the phrase re-runs the
match against the ticket's current labels — no changelog parsing, no
delta bookkeeping. Adapter-authored comments carry a visible
*"Posted by agent-detective · ad-v1"* footer (rendered as a plain
Markdown `---` + italic line so it round-trips reliably through Jira's
Markdown → ADF pipeline); the `comment_created` handler drops anything
containing that footer, optionally cross-checked against
`jiraUser.accountId` / `jiraUser.email`. Two last-resort circuit
breakers backstop the above: the adapter refuses to post more than one
missing-labels reminder to the same issue within a 60-second window,
and it refuses to auto-analyze the same `(issue, repo)` pair more than
once per 10 minutes on non-comment-triggered paths (explicit comment
retries bypass the cooldown because a human explicitly asked for the
re-run). The payload-shape event classifier also treats any
`changelog.items` / `changelog.histories` / `changelog.total > 0`
signal as `issue_updated` (default `ignore`) rather than
`issue_created`, so result comments that Jira Automation echoes back as
bare-issue payloads never get mis-routed into `analyze`. Together these
layers guarantee result comments and reminders can never loop back into
the retry handler. There is no agent-driven discovery fallback. See the "Matching
a ticket to a repository" section in
[jira-manual-e2e.md](./jira-manual-e2e.md) for the full flow.

#### Analysis Configuration

```json
{
  "analysis": {
    "maxCommits": 50
  }
}
```