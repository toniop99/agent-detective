import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineRoute, registerRoutes, type RouteDefinition } from '@agent-detective/sdk';
import { CORE_PLUGIN_TAG } from './openapi/tags.js';
import type {
  AgentRunner,
  EnqueueFn,
  AgentProgressEvent,
} from '@agent-detective/types';
import type { Observability } from '@agent-detective/observability';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface CoreApiControllerDeps {
  agentModels?: {
    [agentId: string]: {
      defaultModel?: string;
    };
  };
  agentRunner?: AgentRunner;
  enqueue?: EnqueueFn;
  observability: Observability;
  config: {
    plugins?: Array<{ package?: string }>;
  };
}

const ServerInfoResponse = z.object({
  name: z.string(),
  version: z.string(),
  plugins: z.array(z.string()),
});

const HealthCheckResponse = z
  .object({ status: z.enum(['ok', 'degraded', 'error']) })
  .passthrough();

const AgentInfoResponse = z.array(
  z
    .object({
      id: z.string(),
      label: z.string(),
      defaultModel: z.string().optional(),
      available: z.boolean().optional(),
      needsPty: z.boolean().optional(),
      mergeStderr: z.boolean().optional(),
    })
    .passthrough(),
);

const QueueStatusResponse = z.object({
  status: z.literal('ok'),
  backend: z.string(),
});

const ErrorResponse = z.object({
  error: z.string(),
  availableAgents: z.array(z.string()).optional(),
  agentId: z.string().optional(),
});

const AgentRunBody = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  prompt: z.string().min(1, 'prompt is required'),
  options: z
    .object({
      model: z.string().optional(),
      repoPath: z.string().nullable().optional(),
      cwd: z.string().optional(),
      threadId: z.string().optional(),
    })
    .optional(),
});

const AgentRunOk = z.object({
  taskId: z.string(),
  output: z.string(),
  sawJson: z.boolean(),
  threadId: z.string().optional(),
});

const ProcessEventBody = z.object({
  type: z.enum(['incident', 'question', 'command']),
  message: z.string().min(1),
  context: z
    .object({
      repoPath: z.string().nullable().optional(),
      threadId: z.string().nullable().optional(),
      cwd: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

const ProcessEventOk = z.object({ taskId: z.string() });

function startSseHeaders(reply: FastifyReply): NodeJS.WritableStream {
  reply.hijack();
  const raw = reply.raw;
  raw.setHeader('Content-Type', 'text/event-stream');
  raw.setHeader('Cache-Control', 'no-cache');
  raw.setHeader('Connection', 'keep-alive');
  raw.setHeader('X-Accel-Buffering', 'no');
  raw.flushHeaders?.();
  return raw;
}

function writeSse(stream: NodeJS.WritableStream, payload: unknown): void {
  stream.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Builds the core API route table. The previous decorator-based controller
 * is gone; the same endpoints are now Zod-validated `defineRoute` records
 * that flow into Fastify (see ADR 0002).
 */
export function buildCoreApiRoutes(deps: CoreApiControllerDeps): RouteDefinition[] {
  const { agentModels, agentRunner, enqueue, observability, config } = deps;

  const getServerInfo = defineRoute({
    method: 'GET',
    url: '/api/',
    schema: {
      tags: [CORE_PLUGIN_TAG],
      summary: 'Get server info',
      description: 'Returns basic information about the agent-detective server',
      response: { 200: ServerInfoResponse },
    },
    handler() {
      const plugins = (config.plugins ?? [])
        .map((p) => p.package)
        .filter((p): p is string => Boolean(p));
      return { name: 'agent-detective', version: '0.1.0', plugins };
    },
  });

  const getHealth = defineRoute({
    method: 'GET',
    url: '/api/health',
    schema: {
      tags: [CORE_PLUGIN_TAG],
      summary: 'Health check',
      description: 'Returns the health status of the server',
      response: { 200: HealthCheckResponse, 503: ErrorResponse },
    },
    async handler(_req, reply) {
      const healthStatus = await observability.health.check();
      const statusCode = healthStatus.status === 'unhealthy' ? 503 : 200;
      return reply.code(statusCode).send(healthStatus);
    },
  });

  const listAgents = defineRoute({
    method: 'GET',
    url: '/api/agent/list',
    schema: {
      tags: [CORE_PLUGIN_TAG],
      summary: 'List available agents',
      description: 'Returns a list of all available AI agents and their status',
      response: { 200: AgentInfoResponse, 503: ErrorResponse },
    },
    async handler(_req, reply) {
      if (!agentRunner) {
        return reply.code(503).send({ error: 'Agent runner not available' });
      }
      const list = await agentRunner.listAgents();
      if (!agentModels) return list;
      return list.map((a) => ({
        ...a,
        defaultModel: agentModels[a.id]?.defaultModel ?? a.defaultModel,
      }));
    },
  });

  const queueStatus = defineRoute({
    method: 'GET',
    url: '/api/queue/status',
    schema: {
      tags: [CORE_PLUGIN_TAG],
      summary: 'Queue status',
      description:
        'In-process task queue: serializes work per task key. No depth metrics exposed yet.',
      response: { 200: QueueStatusResponse },
    },
    handler() {
      return { status: 'ok' as const, backend: 'memory' };
    },
  });

  const runAgent = defineRoute({
    method: 'POST',
    url: '/api/agent/run',
    schema: {
      tags: [CORE_PLUGIN_TAG],
      summary: 'Run AI agent',
      description: 'Executes an AI agent with the provided prompt and options',
      body: AgentRunBody,
      response: { 200: AgentRunOk, 404: ErrorResponse, 503: ErrorResponse },
    },
    async handler(req: FastifyRequest, reply: FastifyReply) {
      const { agentId, prompt, options } = req.body as z.infer<typeof AgentRunBody>;

      if (!agentRunner) {
        return reply.code(503).send({ error: 'Agent runner not available' });
      }

      const list = await agentRunner.listAgents();
      const agentInfo = list.find((a) => a.id === agentId);
      if (!agentInfo) {
        return reply.code(404).send({
          error: `Unknown agent: ${agentId}`,
          availableAgents: list.map((a) => a.id),
        });
      }
      if (!agentInfo.available) {
        return reply.code(404).send({
          error: `Agent '${agentId}' is not installed or not available on this system`,
          agentId,
        });
      }

      const wantsStream = req.headers.accept?.includes('text/event-stream');
      const taskId = randomUUID();

      if (wantsStream) {
        const stream = startSseHeaders(reply);
        try {
          await agentRunner.runAgentForChat(taskId, prompt, {
            agentId,
            repoPath: options?.repoPath,
            cwd: options?.cwd,
            model: options?.model,
            threadId: options?.threadId,
            onProgress: (messages) => {
              for (const msg of messages) {
                writeSse(stream, { type: 'progress', content: msg } satisfies AgentProgressEvent);
              }
            },
            onFinal: (text) => {
              writeSse(stream, { type: 'final', content: text } satisfies AgentProgressEvent);
              stream.end();
            },
          });
        } catch (err) {
          writeSse(stream, {
            type: 'final',
            content: `Error: ${(err as Error).message}`,
          } satisfies AgentProgressEvent);
          stream.end();
        }
        return reply;
      }

      try {
        const output = await agentRunner.runAgentForChat(taskId, prompt, {
          agentId,
          repoPath: options?.repoPath,
          cwd: options?.cwd,
          model: options?.model,
          threadId: options?.threadId,
        });
        return {
          taskId,
          output: output.text,
          sawJson: output.sawJson,
          threadId: output.threadId,
        };
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  });

  const processEvent = defineRoute({
    method: 'POST',
    url: '/api/events',
    schema: {
      tags: [CORE_PLUGIN_TAG],
      summary: 'Process event',
      description: 'Processes a TaskEvent and executes the appropriate agent',
      body: ProcessEventBody,
      response: { 200: ProcessEventOk, 503: ErrorResponse },
    },
    async handler(req: FastifyRequest, reply: FastifyReply) {
      const body = req.body as z.infer<typeof ProcessEventBody>;
      const taskId = randomUUID();

      if (!agentRunner || !enqueue) {
        return reply.code(503).send({ error: 'Agent runner or queue not available' });
      }

      const wantsStream = req.headers.accept?.includes('text/event-stream');

      if (wantsStream) {
        const stream = startSseHeaders(reply);
        try {
          await enqueue(taskId, async () => {
            writeSse(stream, { type: 'progress', content: `Processing event ${taskId}...` });
            await agentRunner.runAgentForChat(taskId, body.message, {
              repoPath: body.context?.repoPath ?? undefined,
              cwd: body.context?.cwd || process.cwd(),
              threadId: body.context?.threadId ?? undefined,
              onProgress: (messages) => {
                for (const msg of messages) {
                  writeSse(stream, { type: 'progress', content: msg });
                }
              },
              onFinal: (text) => {
                writeSse(stream, { type: 'final', content: text });
                stream.end();
              },
            });
          });
        } catch (err) {
          writeSse(stream, { type: 'final', content: `Error: ${(err as Error).message}` });
          stream.end();
        }
        return reply;
      }

      try {
        await enqueue(taskId, async () => {
          await agentRunner.runAgentForChat(taskId, body.message, {
            repoPath: body.context?.repoPath ?? undefined,
            cwd: body.context?.cwd || process.cwd(),
            threadId: body.context?.threadId ?? undefined,
          });
        });
        return { taskId };
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  });

  return [getServerInfo, getHealth, listAgents, queueStatus, runAgent, processEvent];
}

/**
 * Mounts the core API routes on a Fastify instance. Convenience wrapper used
 * by `src/server.ts`; tests can call it directly against an isolated app.
 */
export function registerCoreApiRoutes(app: FastifyInstance, deps: CoreApiControllerDeps): void {
  registerRoutes(app, buildCoreApiRoutes(deps));
}
