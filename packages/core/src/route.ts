import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteOptions,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Per-route schema. All fields are optional; supply Zod schemas for any of
 * `body`, `querystring`, `params`, or `headers` to get runtime validation
 * (rejecting with `400` automatically) AND typed handler arguments.
 *
 * `response` keys are HTTP status codes. The matching Zod schema is used both
 * to **serialize** outgoing responses (drops unknown fields, fast path) and
 * to populate the OpenAPI document.
 */
export interface RouteSchema {
  body?: z.ZodTypeAny;
  querystring?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  headers?: z.ZodTypeAny;
  response?: Record<number, z.ZodTypeAny>;
  /** Free-form OpenAPI fields surfaced by `@fastify/swagger`. */
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
  security?: Record<string, string[]>[];
  consumes?: string[];
  produces?: string[];
}

export interface RouteDefinition {
  method: HttpMethod;
  /** Path relative to the scope (no plugin prefix; `fastify.register` adds that). */
  url: string;
  schema?: RouteSchema;
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  preHandler?: RouteOptions['preHandler'];
  config?: RouteOptions['config'];
}

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
 *     tags: [CORE_PLUGIN_TAG],
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

/**
 * Type alias re-exported for convenience: the Fastify scope handed to
 * `Plugin.register` is just a `FastifyInstance` encapsulated under the
 * plugin's URL prefix. Plugin authors usually want this type for their
 * `register` function signature.
 */
export type FastifyScope = FastifyInstance;
