import 'reflect-metadata';
import express, { type Application, type Request, type Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentRunner,
  EnqueueFn,
} from '@agent-detective/types';
import { createRequestLogger, type Observability, type ObservabilityConfig } from '@agent-detective/observability';
import { apiReference } from '@scalar/express-api-reference';
import {
  registerController,
  generateSpecFromRoutes,
  getRegisteredRoutes,
} from '@agent-detective/core';
import { CoreApiController, createCoreApiController } from './core/core-api-controller.js';
import { sanitizePluginName } from './core/plugin-system.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface Config {
  port?: number;
  agent?: string;
  model?: string;
  agents?: {
    [agentId: string]: {
      defaultModel?: string;
    };
  };
  plugins?: Array<{ package?: string; options?: Record<string, unknown> }>;
  adapters?: Record<string, unknown>;
  observability?: Partial<ObservabilityConfig>;
  docsAuthRequired?: boolean;
  docsApiKey?: string;
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = target[key as keyof T];
    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key as string] = sourceValue;
    }
  }
  return result;
}

export function loadConfig(): Config {
  const baseDir = resolve(__dirname, '..');

  let config: Config = {};

  const defaultConfigPath = resolve(baseDir, 'config', 'default.json');
  if (existsSync(defaultConfigPath)) {
    try {
      config = JSON.parse(readFileSync(defaultConfigPath, 'utf8')) as Config;
    } catch (err) {
      console.warn('Failed to load config/default.json, using defaults:', (err as Error).message);
    }
  }

  const localConfigPath = resolve(baseDir, 'config', 'local.json');
  if (existsSync(localConfigPath)) {
    try {
      const localConfig = JSON.parse(readFileSync(localConfigPath, 'utf8')) as Config;
      config = deepMerge(config, localConfig);
    } catch (err) {
      console.warn('Failed to load config/local.json:', (err as Error).message);
    }
  }

  if (process.env.PORT) {
    config.port = parseInt(process.env.PORT, 10);
  }
  if (process.env.AGENT) {
    config.agent = process.env.AGENT;
  }
  if (process.env.MODEL) {
    config.model = process.env.MODEL;
  }

  const agentModelEnvVars = [
    'AGENTS_OPENCODE_MODEL',
    'AGENTS_CLAUDE_MODEL',
    'AGENTS_GEMINI_MODEL',
  ];

  for (const envVar of agentModelEnvVars) {
    if (process.env[envVar]) {
      const agentId = envVar.replace('AGENTS_', '').replace('_MODEL', '').toLowerCase();
      if (!config.agents) {
        config.agents = {};
      }
      if (!config.agents[agentId]) {
        config.agents[agentId] = {};
      }
      config.agents[agentId].defaultModel = process.env[envVar];
    }
  }

  return config;
}

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
