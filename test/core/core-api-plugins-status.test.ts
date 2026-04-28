import { describe, it } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { createObservability } from '@agent-detective/observability';
import { registerCoreApiRoutes } from '../../src/core/core-api-controller.js';

describe('/api/plugins', () => {
  it('returns configured + loaded + failures', async () => {
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const observability = createObservability({ logging: { level: 'silent' as any } });

    registerCoreApiRoutes(app, {
      observability,
      config: {
        plugins: [
          { package: '@agent-detective/local-repos-plugin' },
          { package: '@agent-detective/jira-adapter' },
        ],
      },
      pluginStatus: () => ({
        loaded: ['@agent-detective/local-repos-plugin@0.1.0'],
        failures: [{ plugin: '@agent-detective/jira-adapter', stage: 'import', message: 'boom' }],
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as any;
    assert.deepEqual(body.configured, ['@agent-detective/local-repos-plugin', '@agent-detective/jira-adapter']);
    assert.deepEqual(body.loaded, ['@agent-detective/local-repos-plugin@0.1.0']);
    assert.equal(body.failures.length, 1);
    await app.close();
  });
});

