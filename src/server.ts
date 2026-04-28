import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import swagger from '@fastify/swagger';
import scalarReference from '@scalar/fastify-api-reference';
import type { OpenAPI } from 'openapi-types';
import { applyTagGroups } from './core/openapi/tag-groups.js';
import { CORE_PLUGIN_TAG, createTagDescription } from './core/openapi/tags.js';
import { createRequestLogger, type Observability } from '@agent-detective/observability';
import type { AgentRunner, EnqueueFn } from '@agent-detective/types';
import { registerCoreApiRoutes } from './core/core-api-controller.js';
import { loadConfig as loadAppConfig, type AppConfig } from './config/load.js';

/** Application config shape (files + env whitelist); alias for callers importing from `server`. */
export type Config = AppConfig;

export const loadConfig = loadAppConfig;

export interface CreateServerOptions {
  /** Provides the dynamic plugin tag list for `x-tagGroups` on the OpenAPI doc. */
  getPluginTags?: () => string[];
  /** Provides plugin system status for core API diagnostics. */
  getPluginStatus?: () => { loaded: string[]; failures: Array<{ plugin: string; stage: string; message: string }> };
}

export interface CreateServerResult {
  /** Fastify instance with the Zod type provider already configured. */
  app: FastifyInstance;
}

/**
 * Builds the root Fastify app: validator/serializer compilers, request
 * logging, OpenAPI doc generation, the Scalar reference UI at `/docs`, and
 * the core API routes. Plugin loading is performed by the caller via
 * `pluginSystem.loadAll(app, config)` *before* `app.listen`, since Fastify
 * requires routes to be registered before the server starts listening.
 */
export async function createServer(
  config: Config,
  observability: Observability,
  agentModels?: { [agentId: string]: { defaultModel?: string } },
  agentRunner?: AgentRunner,
  enqueue?: EnqueueFn,
  options: CreateServerOptions = {},
): Promise<CreateServerResult> {
  const app = Fastify({
    logger: false,
    bodyLimit: 5 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: unknown, _req, reply) => {
    const error = err as Error & { statusCode?: number };
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      observability.logger.error('Unhandled error', error);
    }
    if (reply.sent) return;
    void reply.code(status).send({ error: error.message });
  });

  const obsCfg = (config as { observability?: { requestLogger?: { excludePaths?: string[] } } })
    .observability;
  const excludePaths = obsCfg?.requestLogger?.excludePaths ?? ['/api/health', '/api/metrics'];
  await app.register(
    createRequestLogger({
      logger: observability.logger,
      tracing: observability.tracing,
      metrics: observability.metrics,
      excludePaths,
    }),
  );

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Agent Detective API',
        version: '0.1.0',
        description: 'Core and plugin endpoints for the agent-detective server.',
      },
      servers: [{ url: '/' }],
      tags: [
        { name: CORE_PLUGIN_TAG, description: createTagDescription(CORE_PLUGIN_TAG) },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: (documentObject) => {
      const doc =
        'openapiObject' in documentObject
          ? documentObject.openapiObject
          : documentObject.swaggerObject;
      return applyTagGroups(doc as OpenAPI.Document, {
        pluginTags: options.getPluginTags?.(),
      }) as typeof doc;
    },
  });

  await registerDocsRoute(app, config, observability);

  app.get('/', async () => {
    const pluginPackages = (config.plugins ?? [])
      .map((e) => e.package)
      .filter((p): p is string => Boolean(p));
    return {
      name: 'agent-detective',
      version: '0.1.0',
      plugins: pluginPackages,
    };
  });

  registerCoreApiRoutes(app, {
    agentModels,
    agentRunner,
    enqueue,
    observability,
    config: { plugins: config.plugins },
    pluginStatus: options.getPluginStatus,
  });

  return { app };
}

async function registerDocsRoute(
  app: FastifyInstance,
  config: Config,
  observability: Observability,
): Promise<void> {
  const docsAuthRequired = config.docsAuthRequired ?? process.env.DOCS_AUTH_REQUIRED === 'true';
  const docsApiKey = config.docsApiKey ?? process.env.DOCS_API_KEY;

  await app.register(
    async (scope) => {
      if (docsAuthRequired) {
        scope.addHook('onRequest', async (req, reply) => {
          const apiKey = req.headers['x-api-key'];
          if (!apiKey || apiKey !== docsApiKey) {
            await reply.code(401).send({ error: 'Unauthorized. Provide X-API-KEY header.' });
          }
        });
      }
      await scope.register(scalarReference, {
        routePrefix: '/',
        configuration: {
          metaData: { title: 'Agent Detective API' },
        },
      });
    },
    { prefix: '/docs' },
  );

  observability.logger.info('API documentation available at /docs');
}
