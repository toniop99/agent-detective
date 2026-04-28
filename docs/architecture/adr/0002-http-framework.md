---
title: "ADR 0002: HTTP framework and OpenAPI generation"
description: Architecture decision record for adopting Fastify with Zod-based OpenAPI generation.
sidebar:
  order: 4
---

# ADR 0002: HTTP framework and OpenAPI generation

## Status

Accepted

## Context

The root HTTP app was **Express 5** wired in [`src/server.ts`](../../../src/server.ts), with a homegrown decorator + OpenAPI layer in `packages/core/src/` (`decorators.ts`, `controller.ts`, `metadata.ts`, `spec-generator.ts`) — the package has since been renamed to [`packages/sdk/src/`](../../../packages/sdk/src/) and the decorator code deleted as part of this migration. Plugins receive a `Proxy`-prefixed Express app via [`createPrefixedApp`](../../../src/core/plugin-system.ts) and either call `app.get/post/...` or return controller instances; routes are introspected via `reflect-metadata` after `app.listen` to build an OpenAPI spec rendered by Scalar at `/docs`.

The model works but has well-known rough edges:

- **No runtime request validation.** Decorators like `@RequestBody({ schema })` are documentation-only; handlers manually check `if (!agentId || !prompt)` ([`src/core/core-api-controller.ts`](../../../src/core/core-api-controller.ts)).
- **Hand-written JSON Schema literals.** ~100 lines of inline JSON Schema in [`packages/jira-adapter/src/presentation/jira-webhook-controller.ts`](../../../packages/jira-adapter/src/presentation/jira-webhook-controller.ts), drifting from the runtime payloads.
- **Two schema worlds.** Plugin **config** uses Zod 4 via [`zodToPluginSchema`](../../../packages/sdk/src/zod-to-plugin-schema.ts); HTTP **request/response** schemas are hand-written JSON. Zod 4 is already in the catalog.
- **In-house framework surface to maintain.** ~600 LoC of decorators, controller scanning, and OpenAPI generation that mature libraries provide off the shelf.
- **Plugin scoping is a Proxy hack.** [`createPrefixedApp`](../../../src/core/plugin-system.ts) wraps Express in a `Proxy` to rewrite paths — fragile around middleware ordering and error boundaries.
- **Late spec assembly.** [`src/index.ts`](../../../src/index.ts) builds the OpenAPI spec **after `app.listen`**, coupling startup ordering to the docs pipeline.

The product direction (more plugins, more event sources, more endpoints) makes "validate everything at the boundary, generate OpenAPI from the same source of truth" valuable enough to revisit the framework.

This ADR evaluates four candidates and recommends one. The migration plan is tracked separately in [`docs/exec-plans/completed/2026-04-http-layer-modernization.md`](../../exec-plans/completed/2026-04-http-layer-modernization.md).

## Candidates

All four candidates assume **Zod 4 as the single source of truth** for request and response schemas. They differ in *who* runs validation, *who* renders OpenAPI, and *how* plugins compose.

### A. Express + Zod (incremental)

Keep Express. Replace the custom decorators with a thin `defineRoute({ method, path, request, responses, handler })` registrar. Use [`@asteasolutions/zod-to-openapi`](https://github.com/asteasolutions/zod-to-openapi) to derive the spec; a small middleware validates `req.body` / `req.params` / `req.query` against the Zod schema. Plugin scoping continues via Express `Router` mounted under a prefix (or the existing Proxy, simplified).

```typescript
// packages/core/src/route.ts
import { z } from 'zod';
import type { Request, Response, Router } from 'express';

export interface RouteDef<B, Q, P> {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  path: string;
  tags?: string[];
  summary?: string;
  request?: { body?: z.ZodType<B>; query?: z.ZodType<Q>; params?: z.ZodType<P> };
  responses: Record<number, { description: string; body?: z.ZodType<unknown> }>;
  handler(input: { body: B; query: Q; params: P; req: Request; res: Response }): Promise<unknown> | unknown;
}

export function registerRoutes(router: Router, routes: RouteDef<unknown, unknown, unknown>[]): void {
  for (const r of routes) {
    const mount = router[r.method].bind(router);
    mount(r.path, async (req, res, next) => {
      try {
        const body = r.request?.body ? r.request.body.parse(req.body) : undefined;
        const query = r.request?.query ? r.request.query.parse(req.query) : undefined;
        const params = r.request?.params ? r.request.params.parse(req.params) : undefined;
        const out = await r.handler({ body, query, params, req, res } as never);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (err) { next(err); }
    });
  }
}
```

```typescript
// src/core/core-api-controller.ts (excerpt)
const AgentRunBody = z.object({
  agentId: z.string().min(1),
  prompt: z.string().min(1),
  options: z.object({
    model: z.string().optional(),
    repoPath: z.string().nullable().optional(),
    cwd: z.string().optional(),
    threadId: z.string().optional(),
  }).optional(),
});

export const runAgentRoute = defineRoute({
  method: 'post',
  path: '/api/agent/run',
  tags: [CORE_PLUGIN_TAG],
  summary: 'Run AI agent',
  request: { body: AgentRunBody },
  responses: {
    200: { description: 'Success', body: AgentRunResponse },
    400: { description: 'Bad Request' },
    503: { description: 'Agent runner not available' },
  },
  async handler({ body, req, res }) {
    // body is fully typed; the manual `if (!agentId || !prompt)` is gone.
    return runAgent(body, req, res);
  },
});
```

**Pros**

- Lowest migration cost. Existing Express middleware ([`createRequestLogger`](../../../packages/observability/src/middleware.ts), correlation IDs, body parsers) keeps working.
- Smallest behaviour diff for third-party plugins; their `register(app, ctx)` keeps the Express signature.
- Familiar to most contributors.

**Cons**

- We still **own** a registrar and a small framework. Less code than today, but not zero.
- Plugin scoping stays awkward: either the existing `Proxy` (fragile) or `Router` mounting, neither of which is a real encapsulation boundary.
- No schema-driven response **serialization** (Zod can validate, but Express won't fast-path the output).
- Express performance ceiling is meaningfully lower than Fastify; matters as plugin count grows.

### B. Fastify + `fastify-type-provider-zod` + `@scalar/fastify-api-reference` (recommended)

Move to **Fastify**. Routes are defined with Zod schemas directly via [`fastify-type-provider-zod`](https://github.com/turkerdev/fastify-type-provider-zod); validation, type inference, and OpenAPI fall out of the same Zod object. Plugins map onto Fastify's native `register(plugin, { prefix })` — real encapsulation, isolated hooks/error handlers, no Proxy.

```typescript
// src/server.ts (excerpt)
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';

const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(swagger, {
  openapi: {
    info: { title: 'Agent Detective API', version: '1.0.0' },
    tags: [{ name: CORE_PLUGIN_TAG, description: 'Core API endpoints' }],
  },
});
await app.register(scalar, { routePrefix: '/docs' });
```

```typescript
// packages/jira-adapter/src/presentation/jira-webhook-routes.ts
const JiraWebhookBody = z.object({
  webhookEvent: z.string().optional(),
  issue_event_type_name: z.string().optional(),
  issue: z.object({ key: z.string(), fields: z.record(z.unknown()) }).loose().optional(),
  comment: z.object({ body: z.string() }).loose().optional(),
}).loose();

export async function jiraWebhookPlugin(scope: FastifyInstance, ctx: PluginContext) {
  scope.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: '/webhook',
    schema: {
      body: JiraWebhookBody,
      response: {
        200: JiraWebhookResponse,
        400: ErrorResponse,
        500: ErrorResponse,
      },
      tags: ['@agent-detective/jira-adapter'],
      summary: 'Handle Jira webhook',
    },
    async handler(req, reply) {
      const resolved = resolveWebhookEvent(req);
      return ctx.handler.handleWebhook(req.body, resolved.event);
    },
  });
}

// in plugin-system.ts
await fastify.register(jiraWebhookPlugin, { prefix: `/plugins/${sanitizePluginName(plugin.name)}` });
```

**Pros**

- **Plugin model fits 1:1.** `fastify.register(plugin, { prefix })` replaces `createPrefixedApp` and gives each plugin a real encapsulation boundary (own hooks, own error handler, own decorators).
- **Validation, serialization, and OpenAPI from one Zod object.** The Jira controller's ~100 lines of hand-written JSON Schema collapse to one `z.object`. On Zod 4, use `.loose()` (not deprecated `.passthrough()`) when the schema must allow unknown keys on objects — see [`packages/jira-adapter/src/presentation/jira-webhook-controller.ts`](../../../packages/jira-adapter/src/presentation/jira-webhook-controller.ts).
- **Built-in async error handling.** Errors thrown in handlers route through `setErrorHandler`; no `try/catch + next(err)`.
- **Faster** (~2x throughput vs Express in the typical case) and **ESM-first**, which matches our `"type": "module"` setup.
- **Hooks** (`onRequest`, `preHandler`, `onResponse`) cover the request-logger / metrics ports cleanly.
- Scalar has a [first-party Fastify adapter](https://github.com/scalar/scalar/tree/main/packages/fastify-api-reference); `/docs` UX preserved.

**Cons**

- **Breaking change for third-party plugins.** `Plugin.register(app, ctx)` becomes `register(scope: FastifyInstance, ctx)`. Mitigated by a changeset and a migration note; only affects external authors.
- **Express middleware compatibility** requires `@fastify/express`, which kills the perf advantage. We commit to native Fastify hooks for in-tree code; third-party Express middleware is on the plugin author.
- **SSE ergonomics differ** from Express. The streaming branch in [`runAgent`](../../../src/core/core-api-controller.ts) uses `res.write` directly; under Fastify it becomes `reply.hijack(); reply.raw.write(...)` — small adjustment, well-documented.
- Migration cost is meaningful: every controller, every test that drives Express (`supertest` / direct `app(req, res)`), and the plugin loader change.

### C. NestJS + `@nestjs/swagger` + `nestjs-zod`

Adopt NestJS, the heaviest decorator-first option. NestJS uses Express (or Fastify) as a transport and adds modules, providers, DI, pipes, guards, interceptors, and `@nestjs/swagger` for OpenAPI. `nestjs-zod` lets us keep Zod schemas as the source of truth.

```typescript
@Controller('api/agent')
export class AgentController {
  constructor(private readonly runner: AgentRunnerService) {}

  @Post('run')
  @ApiOperation({ summary: 'Run AI agent' })
  @ApiBody({ schema: zodToOpenAPI(AgentRunBody) })
  async run(@Body(new ZodValidationPipe(AgentRunBody)) body: z.infer<typeof AgentRunBody>) {
    return this.runner.run(body);
  }
}

@Module({ controllers: [AgentController], providers: [AgentRunnerService] })
export class CoreModule {}
```

**Pros**

- Decorators stay (familiar).
- Mature, well-documented framework; lots of features (DI, pipes, guards) out of the box.
- Validation + OpenAPI via `nestjs-zod`.

**Cons**

- **NestJS modules / DI overlap heavily with our existing plugin + service registry** in [`src/core/plugin-system.ts`](../../../src/core/plugin-system.ts) and [`packages/types/src/index.ts`](../../../packages/types/src/index.ts). We'd be running two composition systems side by side — a long-term maintenance hazard.
- Heaviest migration cost of the four; significantly more ceremony per endpoint.
- Steeper learning curve for new contributors; conflicts with the lightweight, plugin-first identity in [ADR 0001](./0001-layering-and-plugin-boundaries.md).
- Performance is bounded by the underlying Express/Fastify adapter plus Nest's per-request DI overhead.

### D. Hono + `@hono/zod-openapi`

Adopt [Hono](https://hono.dev/), a small, fast, multi-runtime web framework with first-class Zod-OpenAPI support.

```typescript
const app = new OpenAPIHono();

app.openapi(createRoute({
  method: 'post',
  path: '/api/agent/run',
  tags: [CORE_PLUGIN_TAG],
  request: { body: { content: { 'application/json': { schema: AgentRunBody } } } },
  responses: { 200: { content: { 'application/json': { schema: AgentRunResponse } }, description: 'OK' } },
}), async (c) => c.json(await runAgent(c.req.valid('json'))));
```

**Pros**

- Excellent TypeScript inference (arguably the best of the four).
- Tiny core, fast.
- Multi-runtime (Bun, Cloudflare, Node) if we ever care.
- Zod and OpenAPI are first-class.

**Cons**

- **Smaller Node-specific ecosystem.** Many integrations (request loggers, metric collectors, body parsers) are Express-first.
- **No first-class plugin encapsulation** comparable to Fastify. We'd build prefix scoping ourselves.
- Loses Express middleware compat entirely; raises the bar for third-party plugin authors more than Fastify does.
- Less mature on Node deployments; smaller community for ops questions.

## Scorecard

Higher is better. "Plugin model fit" is weighted highest — it's what the `@agent-detective/*` ecosystem revolves around.

| Axis (weight)                                | A: Express+Zod | B: Fastify+Zod | C: NestJS | D: Hono |
|----------------------------------------------|:---:|:---:|:---:|:---:|
| Plugin model fit (×3)                        | 2 | **5** | 2 | 2 |
| Zod 4 / schema reuse (×2)                    | 4 | **5** | 4 | 5 |
| OpenAPI quality (×2)                         | 3 | **5** | 5 | 5 |
| Validation / serialization built-in (×2)     | 2 | **5** | 4 | 5 |
| Error handling (×1)                          | 3 | **5** | 5 | 4 |
| Perf (×1)                                    | 2 | **5** | 2 | 5 |
| ESM / Node 24 fit (×1)                       | 4 | **5** | 4 | 5 |
| Ecosystem maturity (×1)                      | 5 | **4** | 5 | 3 |
| Migration cost (×2, inverted: higher = lower cost) | **5** | 3 | 1 | 2 |
| Third-party plugin compat (×1)               | **5** | 3 | 2 | 2 |
| Long-term direction (×2)                     | 2 | **5** | 3 | 4 |
| **Weighted total**                           | 51 | **76** | 50 | 60 |

The weights are debatable; the ranking (B > D > A ≈ C) is robust to ±1 changes in any single axis.

## Decision

**Adopt option B: Fastify + `fastify-type-provider-zod` + `@scalar/fastify-api-reference`.**

Rationale, in priority order:

1. **Plugin encapsulation is the killer feature.** `fastify.register(plugin, { prefix })` replaces the [`createPrefixedApp`](../../../src/core/plugin-system.ts) Proxy with a real boundary (own hooks, own error handler), which directly improves the experience of every future plugin. Nothing else on the table matches this.
2. **One Zod object → validation + serialization + OpenAPI.** Eliminates the hand-written JSON Schema in [`packages/jira-adapter/src/presentation/jira-webhook-controller.ts`](../../../packages/jira-adapter/src/presentation/jira-webhook-controller.ts) and the manual `if (!field)` checks in [`src/core/core-api-controller.ts`](../../../src/core/core-api-controller.ts).
3. **We delete more code than we add.** `decorators.ts`, `controller.ts`, `metadata.ts`, `spec-generator.ts`, the `Proxy`, and the post-`listen` spec assembly all go away.
4. **Express+Zod (A) keeps too much custom framework.** It improves validation but does not address plugin encapsulation or the maintenance burden in `packages/core`.
5. **NestJS (C) duplicates our composition model.** Two systems to teach, two ways to register a route — net negative.
6. **Hono (D) is attractive but loses ecosystem and encapsulation.** Better fit for a serverless-first project than for a self-hosted Node integration hub.

**Decision approved 2026-04-26.** The migration is tracked by [`2026-04-http-layer-modernization.md`](../../exec-plans/completed/2026-04-http-layer-modernization.md).

## Consequences

- **Breaking change for third-party plugins.** `Plugin.register(app: Application, ctx)` becomes `register(scope: FastifyInstance, ctx)` in [`packages/types/src/index.ts`](../../../packages/types/src/index.ts). Documented in [`docs/plugins/plugins.md`](../../plugins/plugins.md) and a changeset.
- **`packages/core` shrinks.** Decorators, controller scanner, metadata helpers, and the OpenAPI spec generator are removed; replaced with a small `defineRoute` / `registerRoutes` API on top of `fastify-type-provider-zod`.
- **`reflect-metadata` is dropped** from the root [`package.json`](../../../package.json).
- **Request-logger middleware** in [`packages/observability/src/middleware.ts`](../../../packages/observability/src/middleware.ts) is ported to Fastify `onRequest` + `onResponse` hooks (correlation IDs, metrics, exclude-paths preserved).
- **SSE** in [`runAgent`](../../../src/core/core-api-controller.ts) and [`processEvent`](../../../src/core/core-api-controller.ts) uses `reply.hijack()` + `reply.raw` (Fastify-idiomatic).
- **Tests under `test/core/openapi/`** are replaced with `defineRoute` / spec-assertion tests using `fastify.inject()` (see [`test/core/http/route.test.ts`](../../../test/core/http/route.test.ts)).

## References

- [`docs/exec-plans/completed/2026-04-http-layer-modernization.md`](../../exec-plans/completed/2026-04-http-layer-modernization.md) — migration plan with acceptance criteria.
- [ADR 0001 — layering and plugin boundaries](./0001-layering-and-plugin-boundaries.md) — keeps applying; this ADR only changes the framework under the presentation layer.
- [`docs/plugins/plugins.md`](../../plugins/plugins.md) — plugin author guide; updated alongside Phase 2.
- [Fastify](https://fastify.dev/) · [`fastify-type-provider-zod`](https://github.com/turkerdev/fastify-type-provider-zod) · [`@scalar/fastify-api-reference`](https://github.com/scalar/scalar/tree/main/packages/fastify-api-reference)
