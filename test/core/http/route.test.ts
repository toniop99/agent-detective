import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import swagger from '@fastify/swagger';
import { z } from 'zod';
import { applyTagGroups, defineRoute, registerRoutes } from '@agent-detective/core';

/**
 * End-to-end check that `defineRoute` + the Zod type provider:
 *   - serves typed responses on the happy path
 *   - rejects malformed bodies with HTTP 400 (no manual validation needed)
 *   - emits OpenAPI paths via `@fastify/swagger`
 *   - decorates the spec with `x-tagGroups` via `applyTagGroups`
 */
describe('defineRoute + Fastify integration', () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    await app.register(swagger, {
      openapi: {
        info: { title: 'test', version: '0.0.0' },
        tags: [{ name: 'core', description: 'core endpoints' }],
      },
      transform: jsonSchemaTransform,
      transformObject: (doc) => {
        const spec = 'openapiObject' in doc ? doc.openapiObject : doc.swaggerObject;
        return applyTagGroups(spec as Parameters<typeof applyTagGroups>[0], {
          pluginTags: ['plugin-x'],
        }) as typeof spec;
      },
    });

    const echoBody = defineRoute({
      method: 'POST',
      url: '/echo',
      schema: {
        tags: ['core'],
        summary: 'Echo back a message',
        body: z.object({ message: z.string().min(1) }),
        response: {
          200: z.object({ echoed: z.string(), length: z.number() }),
        },
      },
      handler: (req) => {
        const body = req.body as { message: string };
        return { echoed: body.message, length: body.message.length };
      },
    });

    const ping = defineRoute({
      method: 'GET',
      url: '/plugins/plugin-x/ping',
      schema: {
        tags: ['plugin-x'],
        summary: 'Plugin ping',
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
      handler: () => ({ ok: true as const }),
    });

    registerRoutes(app, [echoBody, ping]);

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('serves typed responses on the happy path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { message: 'hello' },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { echoed: 'hello', length: 5 });
  });

  it('rejects malformed bodies with HTTP 400 (Zod validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { message: '' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects bodies missing required fields with HTTP 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });

  it('emits an OpenAPI document with both routes', () => {
    const spec = app.swagger();
    assert.ok(spec.paths, 'spec should expose paths');
    assert.ok(spec.paths!['/echo'], 'POST /echo should be present');
    assert.ok(
      spec.paths!['/plugins/plugin-x/ping'],
      'GET /plugins/plugin-x/ping should be present',
    );
  });

  it('groups plugin tags under "Plugins" via applyTagGroups', () => {
    const spec = app.swagger() as Record<string, unknown>;
    const groups = spec['x-tagGroups'] as Array<{ name: string; tags: string[] }> | undefined;
    assert.ok(groups, 'x-tagGroups should be set');
    const pluginsGroup = groups!.find((g) => g.name === 'Plugins');
    assert.ok(pluginsGroup, '"Plugins" group should exist');
    assert.ok(
      pluginsGroup!.tags.includes('plugin-x'),
      '"plugin-x" should be listed under "Plugins"',
    );
  });
});
