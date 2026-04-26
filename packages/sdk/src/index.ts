/**
 * `@agent-detective/sdk` — runtime helpers for plugin authors.
 *
 * Pairs with `@agent-detective/types` (type-only contract: `Plugin`,
 * `PluginContext`, `RouteDefinition`, `RouteSchema`, `HttpMethod`,
 * `FastifyScope`). See ADR 0002 for the framework decision.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { defineRoute, registerRoutes } from '@agent-detective/sdk';
 *
 * const Body = z.object({ agentId: z.string(), prompt: z.string() });
 * const Ok = z.object({ taskId: z.string() });
 *
 * export const runAgent = defineRoute({
 *   method: 'POST',
 *   url: '/api/agent/run',
 *   schema: { body: Body, response: { 200: Ok }, summary: 'Run AI agent' },
 *   async handler(req) {
 *     return runner.run(req.body);
 *   },
 * });
 *
 * // Inside Plugin.register(scope, ctx):
 * registerRoutes(scope, [runAgent]);
 * ```
 */

export {
  defineRoute,
  registerRoutes,
  type RouteDefinition,
  type RouteSchema,
  type HttpMethod,
  type FastifyScope,
} from './route.js';

export { zodToPluginSchema } from './zod-to-plugin-schema.js';
