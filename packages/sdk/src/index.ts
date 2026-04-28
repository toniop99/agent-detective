/**
 * `@agent-detective/sdk` — the single dependency a plugin author needs from
 * this monorepo. Bundles:
 *
 * - **Runtime helpers** — `defineRoute`, `registerRoutes`, `definePlugin`,
 *   `zodToPluginSchema`.
 * - **Service-registry constants** — `REPO_MATCHER_SERVICE`,
 *   `PR_WORKFLOW_SERVICE`, `StandardEvents`.
 * - **Type contract** — every type a plugin needs (`Plugin`, `PluginContext`,
 *   `RepoMatcher`, `LocalReposService`, `PrWorkflowService`, `Logger`,
 *   `TaskEvent`, `AgentRunner`, ...) is re-exported from
 *   `@agent-detective/types`. Plugin `package.json`s should list `sdk` only
 *   and never depend on `@agent-detective/types` directly.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import {
 *   definePlugin,
 *   defineRoute,
 *   registerRoutes,
 *   REPO_MATCHER_SERVICE,
 *   type Plugin,
 *   type RepoMatcher,
 * } from '@agent-detective/sdk';
 *
 * const Body = z.object({ agentId: z.string(), prompt: z.string() });
 * const Ok = z.object({ taskId: z.string() });
 *
 * const runAgent = defineRoute({
 *   method: 'POST',
 *   url: '/api/agent/run',
 *   schema: { body: Body, response: { 200: Ok }, summary: 'Run AI agent' },
 *   async handler(req) {
 *     return runner.run(req.body);
 *   },
 * });
 *
 * export default definePlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   schemaVersion: '1.0',
 *   register(scope, ctx) {
 *     const matcher = ctx.getService<RepoMatcher>(REPO_MATCHER_SERVICE);
 *     registerRoutes(scope, [runAgent]);
 *   },
 * });
 * ```
 */

import type { Plugin } from '@agent-detective/types';

export {
  defineRoute,
  registerRoutes,
  type RouteDefinition,
  type RouteSchema,
  type HttpMethod,
  type FastifyScope,
  type FastifyRequest,
  type FastifyReply,
} from './route.js';

export { zodToPluginSchema } from './zod-to-plugin-schema.js';

export {
  REPO_MATCHER_SERVICE,
  PR_WORKFLOW_SERVICE,
  StandardEvents,
} from './constants.js';

/**
 * Identity helper that anchors a {@link Plugin} declaration for editors and
 * type-checkers. Has no runtime effect; returns its argument unchanged.
 *
 * Mirrors `defineRoute`. Prefer this over `satisfies Plugin` so editor
 * navigation, hover docs, and rename refactors light up.
 *
 * Returns the concrete `Plugin` interface (not a generic over the input
 * shape) so the emitted `.d.ts` for plugins references named types from
 * `@agent-detective/types` rather than inlining transitive `fastify` types
 * — which would break tsup's d.ts bundler in plugin packages that don't
 * list `fastify` as a direct dep.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@agent-detective/sdk';
 *
 * export default definePlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   schemaVersion: '1.0',
 *   register(scope, ctx) {
 *     // ...
 *   },
 * });
 * ```
 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

/**
 * Plugin contract & lifecycle types. Re-exported from `@agent-detective/types`
 * so plugin authors can import them from `@agent-detective/sdk` without
 * taking a direct dep on the type-only package.
 */
export type {
  Plugin,
  PluginContext,
  LoadedPlugin,
  PluginSchema,
  PluginSchemaProperty,
  TaskEvent,
  TaskContext,
  ReplyTarget,
  EventBus,
  EventBusHandler,
  Logger,
  TaskQueue,
  EnqueueFn,
} from '@agent-detective/types';

/**
 * Cross-plugin service contracts (consumed via `context.getService<T>(...)`).
 */
export type {
  RepoMatcher,
  MatchedRepo,
  LocalReposService,
  LocalReposContext,
  RepoConfig,
  RepoVcsConfig,
  RepoVcsProvider,
  ValidatedRepo,
  BuildRepoContextOptions,
  RepoContext,
  Commit,
  RepoMapping,
  RepoMappingEntry,
  RepoMappingConfig,
  ResolveRepoOptions,
  PrWorkflowService,
  PrWorkflowInput,
  PrIssueTrackerClient,
  PrJiraClient,
} from '@agent-detective/types';

/**
 * Agent-runner contract used through `context.agentRunner` and
 * `context.registerAgent`.
 */
export type {
  AgentRunner,
  Agent,
  AgentInfo,
  AgentOutput,
  AgentUsage,
  StreamingOutput,
  RunAgentOptions,
  StopRunResult,
  AgentRunRequest,
  AgentRunResponse,
  AgentProgressEvent,
  BuildCommandOptions,
} from '@agent-detective/types';
