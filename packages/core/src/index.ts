/**
 * `@agent-detective/core` — HTTP route definition helpers on top of Fastify
 * + Zod. Replaces the previous decorator-based API; see ADR 0002.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { defineRoute, registerRoutes, CORE_PLUGIN_TAG } from '@agent-detective/core';
 *
 * const Body = z.object({ agentId: z.string(), prompt: z.string() });
 * const Ok = z.object({ taskId: z.string() });
 *
 * export const runAgent = defineRoute({
 *   method: 'POST',
 *   url: '/api/agent/run',
 *   schema: {
 *     body: Body,
 *     response: { 200: Ok },
 *     tags: [CORE_PLUGIN_TAG],
 *     summary: 'Run AI agent',
 *   },
 *   async handler(req) {
 *     return runner.run(req.body);
 *   },
 * });
 *
 * // In your plugin or host:
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

export {
  applyTagGroups,
  type TagGroup,
  type ApplyTagGroupsOptions,
} from './spec.js';

export {
  CORE_PLUGIN_TAG,
  RESERVED_TAGS,
  SCALAR_TAG_GROUPS,
  createTagDescription,
} from './constants.js';

export { zodToPluginSchema } from './zod-to-plugin-schema.js';
