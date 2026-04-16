import express, { type Application, type Request, type Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  AgentRunner,
  EnqueueFn,
  AgentRunRequest,
  AgentProgressEvent
} from '@agent-detective/types';
import { listAgents, isAgentInstalled, isKnownAgent } from './agents/index.js';
import { createRequestLogger, type Observability, type ObservabilityConfig } from '@agent-detective/observability';

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
  _enqueue?: EnqueueFn
): Application {
  const app = express();

  app.use(express.json());

  app.use(createRequestLogger({
    logger: observability.logger,
    tracing: observability.tracing,
    metrics: observability.metrics,
    excludePaths: ['/health', '/metrics'],
  }));

  app.get('/health', async (_req: Request, res: Response) => {
    const healthStatus = await observability.health.check();
    const statusCode = healthStatus.status === 'ok' ? 200 : healthStatus.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(healthStatus);
  });

  if (observability.config.metrics.enabled) {
    app.get(observability.config.metrics.endpoint, async (_req: Request, res: Response) => {
      try {
        const metrics = await observability.metrics.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (err) {
        res.status(500).send('Error collecting metrics');
      }
    });
  }

  app.get('/agent/list', (_req: Request, res: Response) => {
    const agents = listAgents();
    const agentList = agents.map((agent) => ({
      id: agent.id,
      label: agent.label,
      defaultModel: agentModels?.[agent.id]?.defaultModel || agent.defaultModel,
      available: isAgentInstalled(agent.id),
      needsPty: agent.needsPty,
      mergeStderr: agent.mergeStderr,
    }));
    res.json(agentList);
  });

  app.get('/queue/status', (_req: Request, res: Response) => {
    res.json({ status: 'ok', message: 'Queue status not yet implemented' });
  });

  app.post('/agent/run', async (req: Request, res: Response) => {
    const body = req.body as AgentRunRequest;
    const { agentId, prompt, options } = body;

    if (!agentId || !prompt) {
      res.status(400).json({ error: 'agentId and prompt are required' });
      return;
    }

    if (!_agentRunner) {
      res.status(503).json({ error: 'Agent runner not available' });
      return;
    }

    if (!isKnownAgent(agentId)) {
      const availableAgents = listAgents().map((a) => a.id);
      res.status(404).json({
        error: `Unknown agent: ${agentId}`,
        availableAgents,
      });
      return;
    }

    if (!isAgentInstalled(agentId)) {
      res.status(404).json({
        error: `Agent '${agentId}' is not installed or not in PATH`,
        agentId,
      });
      return;
    }

    const wantsStream = req.headers.accept?.includes('text/event-stream');
    const taskId = randomUUID();

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      try {
        await _agentRunner.runAgentForChat(taskId, prompt, {
          agentId,
          repoPath: options?.repoPath,
          cwd: options?.cwd,
          onProgress: (messages: string[]) => {
            for (const msg of messages) {
              const event: AgentProgressEvent = { type: 'progress', content: msg };
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          },
          onFinal: (text: string) => {
            const event: AgentProgressEvent = { type: 'final', content: text };
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            res.end();
          },
        });
      } catch (error) {
        const event: AgentProgressEvent = { type: 'final', content: `Error: ${(error as Error).message}` };
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        res.end();
      }
    } else {
      try {
        const output = await _agentRunner.runAgentForChat(taskId, prompt, {
          agentId,
          repoPath: options?.repoPath,
          cwd: options?.cwd,
        });
        res.json({ taskId, output, sawJson: false });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    }
  });

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'agent-detective',
      version: '0.1.0',
      adapters: Object.keys(config.adapters || {}),
    });
  });

  app.post('/events', async (req: Request, res: Response) => {
    const body = req.body;
    const taskId = randomUUID();

    if (!body.type || !body.message) {
      res.status(400).json({ error: 'Invalid event: type and message are required' });
      return;
    }

    if (!_agentRunner || !_enqueue) {
      res.status(503).json({ error: 'Agent runner or queue not available' });
      return;
    }

    const wantsStream = req.headers.accept?.includes('text/event-stream');

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      try {
        await _enqueue(taskId, async () => {
          res.write(`data: ${JSON.stringify({ type: 'progress', content: `Processing event ${taskId}...` })}\n\n`);

          await _agentRunner.runAgentForChat(taskId, body.message, {
            repoPath: body.context?.repoPath,
            cwd: body.context?.cwd || process.cwd(),
            onProgress: (messages: string[]) => {
              for (const msg of messages) {
                res.write(`data: ${JSON.stringify({ type: 'progress', content: msg })}\n\n`);
              }
            },
            onFinal: (text: string) => {
              res.write(`data: ${JSON.stringify({ type: 'final', content: text })}\n\n`);
              res.end();
            },
          });
        });
      } catch (error) {
        const event = { type: 'final', content: `Error: ${(error as Error).message}` };
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        res.end();
      }
    } else {
      try {
        await _enqueue(taskId, async () => {
          await _agentRunner.runAgentForChat(taskId, body.message, {
            repoPath: body.context?.repoPath,
            cwd: body.context?.cwd || process.cwd(),
          });
        });
        res.json({ taskId });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    }
  });

  return app;
}
