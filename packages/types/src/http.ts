/**
 * HTTP / OpenAPI type contracts shared between the host and plugin authors.
 *
 * **Type-only.** This file emits zero runtime code: every import is `import
 * type`, and every export is an `interface` or `type` alias. The runtime
 * helpers (`defineRoute`, `registerRoutes`, `applyTagGroups`) live in
 * `@agent-detective/sdk` and `src/core/openapi/` respectively.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
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
 * The Fastify scope handed to `Plugin.register` is just a `FastifyInstance`
 * encapsulated under the plugin's URL prefix. Plugin authors usually want
 * this alias for their `register` function signature.
 */
export type FastifyScope = FastifyInstance;

/**
 * Re-exported Fastify request and reply types so plugin authors can stay on
 * a single dependency (`@agent-detective/sdk`, which re-exports from here)
 * without taking a direct dep on `fastify` for type imports.
 */
export type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Scalar's `x-tagGroups` extension entry — used by the host's
 * `applyTagGroups` helper to render "Core" and "Plugins" sections in the
 * `/docs` sidebar.
 */
export interface TagGroup {
  name: string;
  tags: string[];
}

export interface ApplyTagGroupsOptions {
  /**
   * Tags to place under the "Plugins" group. When omitted, all tags on the
   * spec other than the core tag are treated as plugin tags (typical case:
   * the spec is generated from `@fastify/swagger` after every route has
   * been registered, and tag names match plugin names).
   */
  pluginTags?: string[];
  /**
   * Extra tag descriptions, keyed by tag name.
   */
  descriptions?: Record<string, string>;
}
