# Third-Party Plugin Development Guide

This guide explains how to **develop** and **build** third-party plugins (TypeScript, `dist/`, examples). **How to install and wire** a plugin in production (npm, private registry, `/app/plugins` mounts) is in **[extending-with-plugins.md](extending-with-plugins.md)** — read that first if you only need deployment steps.

## Table of Contents

1. [Overview](#overview)
2. [Plugin Package Structure](#plugin-package-structure)
3. [Plugin Implementation](#plugin-implementation)
4. [Building Your Plugin](#building-your-plugin)
5. [Distributing Your Plugin](#distributing-your-plugin)
6. [Installing Third-Party Plugins](#installing-third-party-plugins)

---

## Overview

Third-party plugins extend agent-detective's capabilities. They can be **published** to npm (or a private registry), **vendored** as a path on disk, or **added** to a fork under `packages/*` (see [extending-with-plugins.md](extending-with-plugins.md) for how the runtime resolves each case).

---

## Plugin Package Structure

```
my-plugin/
├── package.json          # Package metadata
├── tsconfig.json        # TypeScript config
├── tsconfig.build.json  # Build-specific config
├── src/
│   └── index.ts         # Plugin source
├── dist/
│   ├── index.js         # Compiled JavaScript
│   └── index.d.ts       # TypeScript declarations
└── README.md            # Installation instructions
```

### package.json

```json
{
  "name": "@myorg/agent-detective-my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin for agent-detective",
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
    "dev": "tsc -p tsconfig.json --watch"
  },
  "keywords": ["agent-detective", "plugin"],
  "peerDependencies": {
    "@agent-detective/types": "^1.0.0",
    "@agent-detective/sdk": "^1.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@agent-detective/types": "^1.0.0",
    "@agent-detective/sdk": "^1.0.0",
    "zod": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

### tsconfig.build.json

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

> **Note:** No decorator flags are required. Routes are described with Zod schemas via `defineRoute()` (see [API Documentation (OpenAPI)](#api-documentation-openapi) below); the same schemas drive runtime validation and the OpenAPI spec at `/docs`.

Monorepo-only: use `"@agent-detective/types": "workspace:*"`; published plugins should use a **semver** range and depend on the npm release of `@agent-detective/types`.

---

## Plugin Implementation

### Basic Plugin Structure

```typescript
// src/index.ts
import type { Plugin, PluginContext } from '@agent-detective/types';
import { defineRoute, registerRoutes } from '@agent-detective/sdk';
import { z } from 'zod';

const WebhookBody = z.object({ event: z.string() });
const WebhookResponse = z.object({ status: z.literal('received') });

const myPlugin: Plugin = {
  name: '@myorg/agent-detective-my-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      someOption: { type: 'string', default: 'default' },
    },
    required: []
  },

  register(scope, context: PluginContext) {
    const { config, logger } = context;

    if (!config.enabled) {
      logger.info('Plugin is disabled');
      return;
    }

    registerRoutes(scope, [
      defineRoute({
        method: 'POST',
        url: '/webhook',
        schema: {
          tags: ['@myorg/agent-detective-my-plugin'],
          body: WebhookBody,
          response: { 200: WebhookResponse },
        },
        handler: async () => ({ status: 'received' as const }),
      }),
    ]);

    logger.info('My plugin registered successfully');
  }
};

export default myPlugin;
```

> `scope` is a Fastify instance already encapsulated under `/plugins/agent-detective-my-plugin`. The route above mounts at `POST /plugins/agent-detective-my-plugin/webhook` automatically — do not hard-code the prefix.

### PluginContext Members Available

| Member | Type | Description |
|--------|------|-------------|
| `agentRunner` | `AgentRunner` | Execute AI agent prompts |
| `registerService<T>(name, service)` | `function` | Register a service for other plugins to consume |
| `getService<T>(name)` | `function` | Get a registered service by name with type safety |
| `registerCapability(name)` | `function` | Register a capability provided by this plugin |
| `hasCapability(name)` | `function` | Check if a capability is registered |
| `config` | `object` | Validated plugin configuration |
| `logger` | `Logger` | Structured logging |
| `enqueue` | `function` | Queue tasks for sequential execution |

---

## Building Your Plugin

### 1. Create the plugin project

```bash
mkdir my-plugin && cd my-plugin
pnpm init
```

### 2. Install dependencies

```bash
pnpm add @agent-detective/types @agent-detective/sdk zod
pnpm add -D typescript tsx
```

### 3. Build

```bash
pnpm run build
```

### 4. Output

After building, `dist/` contains:
```
dist/
├── index.js      # ES module bundle
└── index.d.ts    # Type declarations
```

---

## Distributing Your Plugin

### Option A: npm Registry (Recommended for Public Plugins)

```bash
# Build
pnpm run build

# Publish to npm
npm publish --access public
```

Users can then install it via:
```bash
npm install @myorg/agent-detective-my-plugin
```

### Option B: GitHub Release

```bash
# Create a release on GitHub
git tag v1.0.0
git push origin v1.0.0

# Users download and extract the dist/ folder
```

### Option C: Private Distribution

Distribute the `dist/` folder directly within your organization:

```bash
# Copy dist/ to a shared location
scp -r dist/ user@server:/path/to/plugins/my-plugin/
```

---

## Installing Third-Party Plugins (runtime)

See **[extending-with-plugins.md](extending-with-plugins.md)** for:

- `package` specifiers (npm, path, monorepo `packages/*`)
- `dependsOn` and load order
- private registry / `.npmrc`
- Docker **`plugins/`** volume and `/app/plugins/...` config

The sections above (**Distributing**) describe how to **publish or copy artifacts**; the extending guide ties that to a running server.

---

## Example: Complete Jira-Style Plugin

### Project Structure

```
my-jira-plugin/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   └── index.ts
├── dist/
│   ├── index.js
│   └── index.d.ts
└── README.md
```

### package.json

```json
{
  "name": "@myorg/agent-detective-jira-plus",
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
    "build": "tsc -p tsconfig.build.json"
  },
  "peerDependencies": {
    "@agent-detective/types": "^1.0.0",
    "@agent-detective/sdk": "^1.0.0",
    "zod": "^4.0.0"
  }
}
```

### src/index.ts

```typescript
import type { Plugin, PluginContext, TaskEvent } from '@agent-detective/types';
import { defineRoute, registerRoutes } from '@agent-detective/sdk';
import { z } from 'zod';

const PLUGIN_TAG = '@myorg/agent-detective-jira-plus';

const WebhookBody = z.object({
  webhookEvent: z.string(),
  issue: z.object({ key: z.string() }).passthrough(),
}).passthrough();

const WebhookResponse = z.object({
  status: z.literal('queued'),
  taskId: z.string(),
});

const jiraPlusPlugin: Plugin = {
  name: PLUGIN_TAG,
  version: '1.0.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      baseUrl: { type: 'string', default: '' },
      email: { type: 'string', default: '' },
      apiToken: { type: 'string', default: '' },
      priorityMapping: {
        type: 'object',
        default: {
          'Critical': 1,
          'Major': 2,
          'Minor': 3
        }
      }
    },
    required: []
  },

  register(scope, context: PluginContext) {
    const { config, agentRunner, logger, getService } = context;

    if (!config.enabled) {
      logger.info('Jira Plus plugin is disabled');
      return;
    }

    const localRepos = getService<{ getRepo(name: string): { path: string } | undefined }>('localRepos');

    registerRoutes(scope, [
      defineRoute({
        method: 'POST',
        url: '/webhook',
        schema: {
          tags: [PLUGIN_TAG],
          summary: 'Receive a Jira webhook',
          body: WebhookBody,
          response: { 200: WebhookResponse },
        },
        handler: async (req) => {
          const taskEvent = normalizePayload(req.body);

          const repo = localRepos?.getRepo(taskEvent.metadata.repoName as string);
          if (repo) {
            taskEvent.context.repoPath = repo.path;
          }

          logger.info(`Processing: ${taskEvent.id}`);

          // Process with agentRunner / enqueue...
          return { status: 'queued' as const, taskId: taskEvent.id };
        },
      }),
    ]);

    logger.info('Jira Plus plugin registered');
  }
};

export default jiraPlusPlugin;
```

---

## API Documentation (OpenAPI)

Plugins expose HTTP endpoints by defining **Zod-typed routes** with `defineRoute()` and mounting them on the Fastify scope passed into `register()`. The same Zod schemas drive runtime validation **and** the OpenAPI spec rendered at `/docs`, so there is no separate "documentation step".

### Adding routes with `defineRoute`

First, add `@agent-detective/sdk` as a dependency:

```json
{
  "dependencies": {
    "@agent-detective/sdk": "workspace:*"
  }
}
```

Then declare your routes with Zod schemas:

```typescript
// src/my-routes.ts
import { defineRoute, registerRoutes, type FastifyScope } from '@agent-detective/sdk';
import { z } from 'zod';
import type { MyService } from './my-service.js';

const PLUGIN_TAG = '@myorg/my-plugin';

const StatusResponse = z.object({
  status: z.literal('ok'),
  plugin: z.literal('my-plugin'),
});

const WebhookBody = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const WebhookResponse = z.object({
  status: z.literal('received'),
  taskId: z.string().optional(),
});

const ErrorResponse = z.object({ error: z.string() });

export function buildMyRoutes(_service: MyService) {
  const getStatus = defineRoute({
    method: 'GET',
    url: '/status',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Get status',
      description: 'Returns current plugin status',
      response: { 200: StatusResponse },
    },
    handler: () => ({ status: 'ok' as const, plugin: 'my-plugin' as const }),
  });

  const handleWebhook = defineRoute({
    method: 'POST',
    url: '/webhook',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Handle webhook',
      description: 'Receives events from external systems',
      body: WebhookBody,
      response: { 200: WebhookResponse, 400: ErrorResponse },
    },
    handler: () => ({ status: 'received' as const }),
  });

  return [getStatus, handleWebhook];
}

export function registerMyRoutes(scope: FastifyScope, service: MyService) {
  registerRoutes(scope, buildMyRoutes(service));
}
```

### Registering routes from the plugin

`scope` is a Fastify instance encapsulated under `/plugins/{sanitized-name}`; routes mount at that prefix automatically.

```typescript
import type { Plugin } from '@agent-detective/types';
import { registerMyRoutes } from './my-routes.js';

const myPlugin: Plugin = {
  name: '@myorg/my-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
    },
  },

  register(scope, context) {
    const { logger } = context;
    const myService = new MyService();
    registerMyRoutes(scope, myService);
    logger.info('My plugin registered');
  },
};

export default myPlugin;
```

### `RouteSchema` reference

| Field | Type | Description |
|-------|------|-------------|
| `body` | `z.ZodType` | Validates `request.body`; rejects with `400` when invalid |
| `querystring` | `z.ZodType` | Validates `request.query` |
| `params` | `z.ZodType` | Validates URL params |
| `headers` | `z.ZodType` | Validates request headers |
| `response` | `Record<number, z.ZodType>` | Per-status response schemas; used for **serialization** (drops unknown fields) and OpenAPI |
| `tags` | `string[]` | Groups the route under tags in `/docs` |
| `summary` / `description` | `string` | Surfaced in OpenAPI |
| `operationId` | `string` | Stable id for the operation |
| `deprecated` | `boolean` | Marks the operation deprecated |
| `security` | `Record<string, string[]>[]` | Security requirements |

### Server-Sent Events

For SSE handlers, call `reply.hijack()` then write to `reply.raw`:

```typescript
defineRoute({
  method: 'GET',
  url: '/events',
  schema: { tags: [PLUGIN_TAG], summary: 'Stream events' },
  handler(_req, reply) {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(`data: ${JSON.stringify({ hello: 'world' })}\n\n`);
  },
});
```

### Accessing API Documentation

- **Without auth**: Visit `/docs` directly
- **With auth**: Set `X-API-KEY` header or configure `DOCS_AUTH_REQUIRED=true` and `DOCS_API_KEY`

### Environment Variables for Docs

| Variable | Description |
|----------|-------------|
| `DOCS_AUTH_REQUIRED=true` | Require API key to access docs |
| `DOCS_API_KEY=<key>` | The API key to use for authentication |

Or via config:
```json
{
  "docsAuthRequired": true,
  "docsApiKey": "your-secret-key"
}
```

---

## Best Practices

1. **Follow semver** - Use meaningful version numbers
2. **Document configuration** - Clear schema with defaults
3. **Handle errors gracefully** - Don't crash the host app
4. **Use logging** - Help users debug issues
5. **Support hot reload** - Design for development ease
6. **Test thoroughly** - Mock external dependencies

---

## Troubleshooting

### Plugin Not Loading

1. Check the plugin directory structure is correct
2. Verify `index.js` is in the right place (not in `dist/`)
3. Ensure `package.json` `name` matches directory name
4. Check logs for schema validation errors

### Type Errors

1. Ensure `@agent-detective/types` version is compatible
2. Run `pnpm run build` to generate `.d.ts` files
3. Use `import type` for type-only imports

### Container Won't Start

1. Verify volume mount path is correct
2. Ensure plugin files are readable
3. Check config syntax in `default.json`
