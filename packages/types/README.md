# @agent-detective/types

**Host-internal, type-only contract package** for agent-detective.

This package emits **zero runtime code** — every export is an `interface` or `type` alias. It exists as the single source of truth for the shared contract between the host (the `agent-detective` app under `src/`) and the workspace packages (plugins, observability, process-utils).

## Audience

Plugin authors should **not** depend on this package directly.

The plugin-author surface lives in [`@agent-detective/sdk`](../sdk/README.md), which re-exports every plugin-facing type from this package alongside the runtime helpers (`defineRoute`, `registerRoutes`, `definePlugin`, `zodToPluginSchema`) and the service-name constants (`REPO_MATCHER_SERVICE`, `PR_WORKFLOW_SERVICE`, `StandardEvents`).

```typescript
// In a plugin: pull everything from sdk
import {
  definePlugin,
  type Plugin,
  type PluginContext,
  type RepoMatcher,
  REPO_MATCHER_SERVICE,
} from '@agent-detective/sdk';
```

## What lives here

- Plugin contract: `Plugin`, `PluginContext`, `LoadedPlugin`, `PluginSchema`, `PluginSchemaProperty`.
- Task / event types: `TaskEvent`, `TaskContext`, `ReplyTarget`, `EventBus`, `EventBusHandler`, `Logger`, `TaskQueue`, `EnqueueFn`.
- Service contracts: `RepoMatcher`, `LocalReposService`, `PrWorkflowService`, `RepoConfig`, `ValidatedRepo`, `Commit`, etc.
- Agent contract: `AgentRunner`, `Agent`, `AgentInfo`, `AgentOutput`, `StreamingOutput`, `RunAgentOptions`, `BuildCommandOptions`.
- HTTP contract (`./http.ts`): `RouteDefinition`, `RouteSchema`, `HttpMethod`, `FastifyScope`, `FastifyRequest`, `FastifyReply`, `TagGroup`, `ApplyTagGroupsOptions`.
- Host-only types: `ProcessUtils`, `ExecLocalOptions`, `ExecLocalStreamingOptions` — used by `@agent-detective/process-utils` and the host, **not** re-exported through sdk.

## License

MIT
