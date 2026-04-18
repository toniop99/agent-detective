# Third-Party Plugin Development Guide

This guide explains how to develop and distribute third-party plugins for agent-detective.

## Table of Contents

1. [Overview](#overview)
2. [Plugin Package Structure](#plugin-package-structure)
3. [Plugin Implementation](#plugin-implementation)
4. [Building Your Plugin](#building-your-plugin)
5. [Distributing Your Plugin](#distributing-your-plugin)
6. [Installing Third-Party Plugins](#installing-third-party-plugins)

---

## Overview

Third-party plugins extend agent-detective's capabilities. They can be:

- **Shared publicly** on npm or GitHub
- **Distributed privately** within an organization

Plugins are loaded from:
1. **Bundled plugins** - Pre-installed in the official image
2. **Third-party plugins** - Installed via volume mount in `/app/plugins/{plugin-name}/`

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
    "@agent-detective/types": "^1.0.0"
  },
  "devDependencies": {
    "@agent-detective/types": "^1.0.0",
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
    "outDir": "./dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*"]
}
```

> **Note:** `experimentalDecorators` and `emitDecoratorMetadata` are required for OpenAPI decorators to work properly.
```

---

## Plugin Implementation

### Basic Plugin Structure

```typescript
// src/index.ts
import type { Plugin, PluginContext } from '@agent-detective/types';

const myPlugin: Plugin = {
  name: '@myorg/agent-detective-my-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      webhookPath: { type: 'string', default: '/plugins/agent-detective-my-plugin/webhook' },
      someOption: { type: 'string', default: 'default' },
    },
    required: []
  },

  register(app, context: PluginContext) {
    const { config, agentRunner, plugins, logger } = context;

    if (!config.enabled) {
      logger.info('Plugin is disabled');
      return;
    }

    const webhookPath = config.webhookPath as string;

    app.post(webhookPath, async (req, res) => {
      // Handle webhook...
    });

    logger.info('My plugin registered successfully');
  }
};

export default myPlugin;
```

### PluginContext Members Available

| Member | Type | Description |
|--------|------|-------------|
| `agentRunner` | `AgentRunner` | Execute AI agent prompts |
| `plugins` | `object` | Access to other loaded plugins (e.g. local-repos) |
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
pnpm add @agent-detective/types
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

## Installing Third-Party Plugins

### Directory Structure

When installing manually (volume mount), organize plugins as:

```
plugins/
└── my-plugin/           # Plugin directory (same as package name)
    ├── index.js         # Main entry (NOT in dist/)
    └── index.d.ts       # Type declarations
```

### For Volume Mount Users

```bash
# Build the plugin
cd my-plugin
pnpm run build

# Copy to plugins directory
mkdir -p plugins
cp -r dist plugins/my-plugin

# Rename files
mv plugins/my-plugin/index.js plugins/my-plugin/
mv plugins/my-plugin/index.d.ts plugins/my-plugin/

# Verify structure
ls -la plugins/my-plugin/
# index.js  index.d.ts
```

### Docker Run Example

```bash
docker run -d -p 3001:3001 \
  -v $(pwd)/plugins:/app/plugins:ro \
  ghcr.io/toniop99/agent-detective:latest
```

### Configuration

Add to `config/default.json`:

```json
{
  "plugins": [
    {
      "package": "/app/plugins/my-plugin",
      "options": {
        "enabled": true,
        "webhookPath": "/plugins/agent-detective-my-plugin/webhook"
      }
    }
  ]
}
```

### Alternative: Package Name

If your plugin is published to npm:

```json
{
  "plugins": [
    {
      "package": "@myorg/agent-detective-my-plugin",
      "options": {
        "enabled": true
      }
    }
  ]
}
```

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
    "@agent-detective/types": "^1.0.0"
  }
}
```

### src/index.ts

```typescript
import type { Plugin, PluginContext, TaskEvent } from '@agent-detective/types';

const jiraPlusPlugin: Plugin = {
  name: '@myorg/agent-detective-jira-plus',
  version: '1.0.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      webhookPath: { type: 'string', default: '/plugins/agent-detective-my-plugin/webhook' },
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
    required: ['webhookPath']
  },

  register(app, context: PluginContext) {
    const { config, agentRunner, plugins, logger } = context;

    if (!config.enabled) {
      logger.info('Jira Plus plugin is disabled');
      return;
    }

    app.post(config.webhookPath as string, async (req, res) => {
      const taskEvent = normalizePayload(req.body);
      
      // Discovery logic...
      const repo = localRepos?.getRepo(taskEvent.metadata.repoName as string);
      if (repo) {
        taskEvent.context.repoPath = repo.path;
      }

      logger.info(`Processing: ${taskEvent.id}`);
      
      // Process with agent...
      res.json({ status: 'queued', taskId: taskEvent.id });
    });

    logger.info('Jira Plus plugin registered');
  }
};

export default jiraPlusPlugin;
```

---

## API Documentation (OpenAPI)

Plugins can provide OpenAPI metadata for auto-generated API documentation at `/docs` using decorator-based approach.

### Adding OpenAPI Metadata with Decorators

First, add `@agent-detective/core` as a dependency:

```json
{
  "dependencies": {
    "@agent-detective/core": "workspace:*"
  }
}
```

Then create a controller class with decorators:

```typescript
// src/my-controller.ts
import type { Request, Response } from 'express';
import {
  Controller,
  Get,
  Post,
  Summary,
  Description,
  Tags,
  Response as OpenApiResponse,
  RequestBody,
} from '@agent-detective/core';

const PLUGIN_TAG = '@myorg/my-plugin';

@Controller('/api', { tags: [PLUGIN_TAG], description: 'My plugin endpoints' })
export class MyController {
  private myService?: MyService;

  constructor(myService?: MyService) {
    this.myService = myService;
  }

  setMyService(service: MyService): void {
    this.myService = service;
  }

  @Get('/status')
  @Summary('Get status')
  @Description('Returns current plugin status')
  @Tags(PLUGIN_TAG)
  @OpenApiResponse(200, 'Success', {
    example: { status: 'ok', plugin: 'my-plugin' }
  })
  getStatus(_req: Request, res: Response) {
    res.json({ status: 'ok', plugin: 'my-plugin' });
  }

  @Post('/webhook')
  @Summary('Handle webhook')
  @Description('Receives events from external systems')
  @Tags(PLUGIN_TAG)
  @RequestBody({
    description: 'Webhook payload',
    required: true,
    example: { event: 'issue_created', data: { id: '123' } },
    schema: {
      type: 'object',
      properties: {
        event: { type: 'string' },
        data: { type: 'object' }
      },
      required: ['event']
    }
  })
  @OpenApiResponse(200, 'Success', {
    example: { status: 'received', taskId: 'abc123' }
  })
  @OpenApiResponse(400, 'Bad Request')
  handleWebhook(req: Request, res: Response) {
    // Handle webhook
    res.json({ status: 'received' });
  }
}
```

### Registering the Controller

In your plugin's register function:

```typescript
import type { Plugin, PluginContext } from '@agent-detective/types';
import { registerController } from '@agent-detective/core';
import { MyController } from './my-controller.js';

const myPlugin: Plugin = {
  name: '@myorg/my-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',

  schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true }
    }
  },

  register(app, context) {
    const { logger } = context;

    const myService = new MyService();
    const controller = new MyController(myService);
    controller.setMyService(myService);

    registerController(app, controller);

    logger.info('My plugin registered');
  }
};

export default myPlugin;
```

### Available Decorators

| Decorator | Type | Description |
|-----------|------|-------------|
| `@Controller(prefix, options?)` | Class | Marks a class as a controller with base path |
| `@Get(path)` | Method | Marks a method as GET endpoint |
| `@Post(path)` | Method | Marks a method as POST endpoint |
| `@Put(path)` | Method | Marks a method as PUT endpoint |
| `@Delete(path)` | Method | Marks a method as DELETE endpoint |
| `@Patch(path)` | Method | Marks a method as PATCH endpoint |
| `@Summary(text)` | Method | Adds summary to OpenAPI spec |
| `@Description(text)` | Method | Adds description to OpenAPI spec |
| `@Tags(...tags)` | Method | Adds tags for grouping in docs |
| `@RequestBody(options?)` | Method | Documents request body |
| `@Response(status, desc, options?)` | Method | Documents response |
| `@OperationId(id)` | Method | Sets operation ID |
| `@Deprecated()` | Method | Marks endpoint as deprecated |
| `@Security(scheme)` | Method | Adds security scheme |

### Response Decorator Options

```typescript
@OpenApiResponse(200, 'Success', {
  contentType: 'application/json',
  example: { id: 1, name: 'Example' },
  schema: {
    type: 'object',
    properties: {
      id: { type: 'number' },
      name: { type: 'string' }
    }
  }
})
```

### RequestBody Decorator Options

```typescript
@RequestBody({
  description: 'User data',
  required: true,
  contentType: 'application/json',
  example: { name: 'John', email: 'john@example.com' },
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string', format: 'email' }
    },
    required: ['name', 'email']
  }
})
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
