import type { FastifyInstance, RouteOptions } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RouteDefinition } from '@agent-detective/types';

export type {
  HttpMethod,
  RouteSchema,
  RouteDefinition,
  FastifyScope,
} from '@agent-detective/types';

/**
 * Identity helper that gives editors and type-checkers an anchor for a route
 * definition. Has no runtime effect; returns its argument unchanged.
 *
 * @example
 * export const runAgent = defineRoute({
 *   method: 'POST',
 *   url: '/api/agent/run',
 *   schema: {
 *     body: AgentRunBody,
 *     response: { 200: AgentRunResponse, 400: ErrorBody },
 *     tags: ['@agent-detective/core'],
 *     summary: 'Run AI agent',
 *   },
 *   async handler(req) { ... },
 * });
 */
export function defineRoute(def: RouteDefinition): RouteDefinition {
  return def;
}

/**
 * Registers a list of {@link RouteDefinition}s on a Fastify scope, wiring the
 * Zod type provider so handlers receive typed `request.body` / `params` /
 * `query` and responses are serialized through the matching response schema.
 */
export function registerRoutes(scope: FastifyInstance, routes: RouteDefinition[]): void {
  const typed = scope.withTypeProvider<ZodTypeProvider>();
  for (const route of routes) {
    typed.route(route as RouteOptions);
  }
}
