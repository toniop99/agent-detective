# Plugin Development Guide

Plugins extend code-detective to connect any event source (Jira, Telegram, Slack, etc.). This guide covers everything you need to build a plugin.

## Table of Contents

1. [Plugin Anatomy](#1-plugin-anatomy)
2. [Core Context Reference](#2-core-context-reference)
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
import type { Plugin, PluginContext } from '@code-detective/types';

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
| `name` | `string` | Unique plugin identifier (e.g., `@code-detective/jira-adapter`) |
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
    localRepos,              // access to configured repositories
    buildRepoContext,        // analyze repository (git log, error search)
    formatRepoContextForPrompt, // format repo analysis for prompts
    config,                   // validated plugin config with defaults applied
    logger,                   // logger with plugin prefix
  } = context;
  // ...
}
```

### Available Context Members

| Member | Type | Description |
|--------|------|-------------|
| `agentRunner` | `AgentRunner` | Executes AI agent prompts (see Section 10) |
| `localRepos` | `LocalReposContext` | Access to configured repositories |
| `buildRepoContext(repoPath, options)` | `function` | Builds repo analysis (git log, error search) |
| `formatRepoContextForPrompt(context)` | `function` | Formats repo context as a markdown string for prompts |
| `config` | `object` | Plugin config validated against schema, with defaults merged |
| `logger` | `Logger` | Logger with `.info()`, `.warn()`, `.error()` |

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
  name: '@code-detective/my-adapter',
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
  source: '@code-detective/my-adapter', // Plugin name

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
  "name": "@myorg/code-detective-jira",
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
    "@code-detective/types": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  }
}
```

### Full Implementation

```typescript
// packages/my-jira/src/index.ts
import type { Plugin, PluginContext, TaskEvent, RepoContext } from '@code-detective/types';
import { normalizePayload } from './normalizer.js';
import { createJiraClient } from './jira-client.js';

const plugin: Plugin = {
  name: '@myorg/code-detective-jira',
  version: '0.1.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      webhookPath: { type: 'string', default: '/plugins/code-detective-jira-adapter/webhook/jira' },
      mockMode: { type: 'boolean', default: false },
      baseUrl: { type: 'string', default: '' },
      email: { type: 'string', default: '' },
      apiToken: { type: 'string', default: '' },
      repoContext: {
        type: 'object',
        default: {
          gitLogMaxCommits: 50,
          searchPatterns: ['*.js', '*.ts', '*.py'],
        },
      },
    },
    required: ['webhookPath'],
  },

  register(app, context: PluginContext) {
    const { config, agentRunner, repoMapping, buildRepoContext, formatRepoContextForPrompt, logger } = context;

    if (!config.enabled) {
      logger.info(`Plugin is disabled`);
      return;
    }

    const jiraClient = config.mockMode
      ? createMockJiraClient()
      : createRealJiraClient(config);

    const webhookPath = config.webhookPath as string;

    app.post(webhookPath, async (req, res) => {
      try {
        const taskEvent = normalizePayload(req.body);

        const repoPath = repoMapping.resolveRepoFromMapping({
          labels: (taskEvent.metadata.labels as string[]) || [],
          projectKey: (taskEvent.metadata.projectKey as string) || '',
        });
        taskEvent.context.repoPath = repoPath;

        logger.info(`Webhook: ${taskEvent.id} -> repo: ${repoPath || 'none'}`);

        enqueueTask(taskEvent.id, async () => {
          await processTask(taskEvent, { config, agentRunner, jiraClient, buildRepoContext, formatRepoContextForPrompt, logger });
        });

        res.json({ status: 'queued', taskId: taskEvent.id });
      } catch (err) {
        logger.error(`Webhook error: ${(err as Error).message}`);
        res.status(500).json({ error: (err as Error).message });
      }
    });

    logger.info(`Jira adapter registered at ${webhookPath}`);
  },
};

export default plugin;

async function processTask(
  taskEvent: TaskEvent,
  { config, agentRunner, jiraClient, buildRepoContext, formatRepoContextForPrompt, logger }: PluginContext & { jiraClient: JiraClient }
) {
  let repoContextText = '';

  if (taskEvent.context.repoPath) {
    try {
      const repoContext = await buildRepoContext(taskEvent.context.repoPath, {
        maxCommits: (config.repoContext as { gitLogMaxCommits?: number })?.gitLogMaxCommits || 50,
        searchPatterns: (config.repoContext as { searchPatterns?: string[] })?.searchPatterns || ['*.js', '*.ts', '*.py'],
      });
      repoContextText = formatRepoContextForPrompt(repoContext);
    } catch (err) {
      logger.warn(`Failed to build repo context: ${(err as Error).message}`);
    }
  }

  const prompt = buildPrompt(taskEvent, repoContextText);

  await agentRunner.runAgentForChat(taskEvent.id, prompt, {
    contextKey: taskEvent.id,
    repoPath: taskEvent.context.repoPath,
    onFinal: async (commentText: string) => {
      await jiraClient.addComment(taskEvent.replyTo.id, commentText);
      logger.info(`Comment added to ${taskEvent.replyTo.id}`);
    },
  });
}

function buildPrompt(taskEvent: TaskEvent, repoContextText: string): string {
  const lines: string[] = [];
  lines.push(taskEvent.message);
  lines.push('');

  if (repoContextText) {
    lines.push('### Repository Context');
    lines.push(repoContextText);
  } else {
    lines.push('(No repository context available)');
  }

  lines.push('');
  lines.push('### Task');
  lines.push('Analyze the incident and provide:');
  lines.push('1. Possible root causes');
  lines.push('2. Files or areas to investigate');
  lines.push('3. Suggested fixes or debugging steps');

  return lines.join('\n');
}
```

### Minimal Normalizer

```typescript
// packages/my-jira/src/normalizer.ts
import type { TaskEvent } from '@code-detective/types';

export function normalizePayload(payload: JiraPayload): TaskEvent {
  const issue = payload.issue || payload;

  return {
    id: issue.key || String(Date.now()),
    type: 'incident',
    source: '@myorg/code-detective-jira',
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
import type { Plugin, PluginContext, TaskEvent } from '@code-detective/types';

const plugin: Plugin = {
  name: '@myorg/code-detective-telegram',
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
    const { config, agentRunner, repoMapping, buildRepoContext, formatRepoContextForPrompt, logger } = context;

    if (!config.enabled) return;

    const telegram = createTelegramBot(config.botToken as string);

    telegram.on('message', async (msg) => {
      const { chatId, text, messageId } = msg;

      const projectMatch = text.match(/proj:(\S+)/);
      const repoPath = projectMatch
        ? repoMapping.resolveProjectFromName(projectMatch[1])
        : (config.defaultRepoPath as string) || null;

      const taskEvent: TaskEvent = {
        id: `${chatId}:${messageId}`,
        type: 'question',
        source: '@myorg/code-detective-telegram',
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

      enqueueTask(taskEvent.context.threadId, async () => {
        await processQuestion(taskEvent, { config, agentRunner, buildRepoContext, formatRepoContextForPrompt, telegram, logger });
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
import type { Plugin, PluginContext, TaskEvent } from '@code-detective/types';

const plugin: Plugin = {
  name: '@myorg/code-detective-slack',
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
import type { Plugin, PluginContext } from '@code-detective/types';

const plugin: Plugin = {
  name: '@myorg/code-detective-poller',
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
    const { config, agentRunner, repoMapping, buildRepoContext, formatRepoContextForPrompt, logger } = context;

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
          await processTask(taskEvent, { config, agentRunner, repoMapping, buildRepoContext, formatRepoContextForPrompt, logger });
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
code-detective/
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
  "name": "@myorg/code-detective-my-adapter",
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
    "@code-detective/types": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  },
  "keywords": ["code-detective", "plugin"]
}
```

**3. Publish to npm:**

```bash
cd my-adapter
pnpm install
pnpm run build
pnpm publish --access public
```

**4. Install in code-detective:**

```bash
cd code-detective
pnpm add @myorg/code-detective-my-adapter
```

**5. Configure in `config/default.json`:**

```json
{
  "plugins": [
    {
      "package": "@myorg/code-detective-my-adapter",
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
3. Try `import(packages/{name}/src/index.js)` where `@code-detective/X` maps to `packages/X/src/index.js`

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

### RepoMapping

Available in plugins via `context.repoMapping`.

#### `repoMapping.resolveRepoFromMapping(options)`

Resolves a repository path from labels/project key.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.labels` | `string[]` | Jira labels or tags |
| `options.projectKey` | `string` | Project key (e.g., `PROJ`) |
| `options.projectName` | `string` | Project name (e.g., `awesome-symfony`) |

**Returns:** `string | null` - absolute path to repository

---

### BuildRepoContext

Available in plugins via `context.buildRepoContext`.

#### `buildRepoContext(repoPath, options)`

Analyzes a repository and returns context for prompts.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `repoPath` | `string` | required | Absolute path to repository |
| `options.maxCommits` | `number` | `50` | Max recent commits to retrieve |
| `options.searchPatterns` | `string[]` | `['*.js', '*.ts', '*.py']` | File patterns to search |
| `options.errorPatterns` | `boolean` | `true` | Search for error patterns |

**Returns:** `Promise<RepoContext>`

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
  assert.equal(taskEvent.source, '@myorg/code-detective-jira');
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

**Package:** `@code-detective/local-repos-plugin`

**Can Disable:** Yes (`"enabled": false` in config)

**Configuration:**
```json
{
  "plugins": [
    {
      "package": "@code-detective/local-repos-plugin",
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

Handles Jira webhooks with intelligent repository discovery.

**Package:** `@code-detective/jira-adapter`

**Can Disable:** Yes (`"enabled": false` in config)

**Configuration:**
```json
{
  "plugins": [
    {
      "package": "@code-detective/jira-adapter",
      "options": {
        "enabled": true,
        "webhookPath": "/plugins/code-detective-jira-adapter/webhook/jira",
        "mockMode": false,
        "baseUrl": "https://your-domain.atlassian.net",
        "email": "bot@example.com",
        "apiToken": "your-api-token"
      }
    }
  ]
}
```