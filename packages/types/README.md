# @agent-detective/types

Shared TypeScript type definitions for agent-detective core and plugins.

## Installation

```bash
npm install @agent-detective/types
```

## Usage

```typescript
import type { Plugin, PluginContext } from '@agent-detective/types';
```

## Types Included

### Core Interfaces

- **TaskEvent** - The common interface that all adapters produce
- **TaskContext** - Context information for a task
- **ReplyTarget** - Where to send responses

### Plugin Interface

- **Plugin** - What a plugin must export
- **PluginSchema** - Configuration schema for a plugin
- **PluginContext** - What the core injects into plugins
- **Logger** - Logging interface

### Agent Interfaces

- **Agent** - AI agent definition
- **AgentRunner** - Interface for running agents
- **AgentOutput** - Output from an agent
- **StreamingOutput** - Streaming agent output

### Repository Interfaces

- **RepoContext** - Repository context information
- **RepoMapping** - Interface for resolving repository paths
- **Commit** - Git commit information
- **SearchResult** - File search result

### Process Interfaces

- **ExecLocalOptions** - Options for local command execution
- **ProcessUtils** - Process utility functions

## For Plugin Developers

When building a plugin for agent-detective, import the types you need:

```typescript
import type { Plugin, PluginSchema, PluginContext } from '@agent-detective/types';

const myPlugin: Plugin = {
  name: '@myorg/my-plugin',
  version: '1.0.0',
  schema: { type: 'object', properties: {}, required: [] },
  register(app, context: PluginContext) {
    // Your plugin logic
  }
};

export default myPlugin;
```

## Version Compatibility

| @agent-detective/types | agent-detective |
|----------------------|----------------|
| 1.x | 0.x |

## License

MIT