import 'reflect-metadata';
import express, { type Application, type Request, type Response } from 'express';
import type {
  AgentRunner,
  EnqueueFn,
} from '@agent-detective/types';
import { createRequestLogger, type Observability } from '@agent-detective/observability';
import { apiReference } from '@scalar/express-api-reference';
import {
  registerController,
  generateSpecFromRoutes,
} from '@agent-detective/core';
import { CoreApiController, createCoreApiController } from './core/core-api-controller.js';
import { loadConfig as loadAppConfig, type AppConfig } from './config/load.js';

/** Application config shape (files + env whitelist); alias for callers importing from `server`. */
export type Config = AppConfig;

export const loadConfig = loadAppConfig;

export function createServer(
  config: Config,
  observability: Observability,
  agentModels?: {
    [agentId: string]: {
      defaultModel?: string;
    };
  },
  _agentRunner?: AgentRunner,
  _enqueue?: EnqueueFn,
): { app: Application; coreController: CoreApiController } {
  const app = express();

  app.use(express.json());

  app.use(createRequestLogger({
    logger: observability.logger,
    tracing: observability.tracing,
    metrics: observability.metrics,
    excludePaths: ['/api/health', '/api/metrics'],
  }));

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'agent-detective',
      version: '0.1.0',
      adapters: Object.keys(config.adapters || {}),
    });
  });

  const coreController = createCoreApiController({
    agentModels,
    agentRunner: _agentRunner,
    enqueue: _enqueue,
    observability,
    config: {
      adapters: config.adapters,
    },
  });

  registerController(app, coreController);

  return { app, coreController };
}

export function setupDocs(
  app: Application,
  allRoutes: Array<{
    method: string;
    path: string;
    prefixedPath: string;
    pluginName: string;
    operationMetadata?: import('@agent-detective/core').OperationMetadata;
  }>,
  observability: Observability,
  config: Config
): void {
  const docsAuthRequired = config.docsAuthRequired ?? process.env.DOCS_AUTH_REQUIRED === 'true';
  const docsApiKey = config.docsApiKey ?? process.env.DOCS_API_KEY;

  app.use('/docs', (req, res, next) => {
    if (docsAuthRequired) {
      const apiKey = req.headers['x-api-key'];
      if (!apiKey || apiKey !== docsApiKey) {
        res.status(401).json({ error: 'Unauthorized. Provide X-API-KEY header.' });
        return;
      }
    }

    const spec = generateSpecFromRoutes(allRoutes);

    const apiRefMiddleware = apiReference({
      content: spec,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return apiRefMiddleware(req as any, res as any, next);
  });

  observability.logger.info('API documentation available at /docs');
}
