import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  Controller,
  Get,
  Post,
  Summary,
  Description,
  Tags,
  Response as OpenApiResponse,
  RequestBody,
  CORE_PLUGIN_TAG,
} from '@agent-detective/core';
import type {
  AgentRunner,
  EnqueueFn,
  AgentRunRequest,
  AgentProgressEvent,
  Agent,
} from '@agent-detective/types';
import type { Observability } from '@agent-detective/observability';
import { listAgents, isAgentInstalled, isKnownAgent } from '../agents/index.js';

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
    adapters?: Record<string, unknown>;
  };
}

@Controller('/api', { tags: [CORE_PLUGIN_TAG], description: 'Core API endpoints' })
export class CoreApiController {
  private agentModels?: CoreApiControllerDeps['agentModels'];
  private agentRunner?: CoreApiControllerDeps['agentRunner'];
  private enqueue?: CoreApiControllerDeps['enqueue'];
  private observability?: CoreApiControllerDeps['observability'];
  private config?: CoreApiControllerDeps['config'];

  constructor(deps?: CoreApiControllerDeps) {
    if (deps) {
      this.agentModels = deps.agentModels;
      this.agentRunner = deps.agentRunner;
      this.enqueue = deps.enqueue;
      this.observability = deps.observability;
      this.config = deps.config;
    }
  }

  @Get('/')
  @Summary('Get server info')
  @Description('Returns basic information about the agent-detective server')
  @Tags(CORE_PLUGIN_TAG)
  @OpenApiResponse(200, 'Success', {
    example: {
      name: 'agent-detective',
      version: '0.1.0',
      adapters: ['jira'],
    },
  })
  getServerInfo(_req: Request, res: Response) {
    res.json({
      name: 'agent-detective',
      version: '0.1.0',
      adapters: Object.keys(this.config?.adapters || {}),
    });
  }

  @Get('/health')
  @Summary('Health check')
  @Description('Returns the health status of the server')
  @Tags(CORE_PLUGIN_TAG)
  @OpenApiResponse(200, 'Healthy', { example: { status: 'ok', timestamp: '2026-04-16T00:00:00.000Z' } })
  @OpenApiResponse(503, 'Service unavailable')
  async getHealth(_req: Request, res: Response) {
    if (!this.observability) {
      res.status(503).json({ error: 'Observability not available' });
      return;
    }
    const healthStatus = await this.observability.health.check();
    const statusCode = healthStatus.status === 'ok' ? 200 : healthStatus.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(healthStatus);
  }

  @Get('/agent/list')
  @Summary('List available agents')
  @Description('Returns a list of all available AI agents and their status')
  @Tags(CORE_PLUGIN_TAG)
  @OpenApiResponse(200, 'Success', {
    example: [
      {
        id: 'opencode',
        label: 'OpenCode Agent',
        defaultModel: 'claude-3-5-sonnet',
        available: true,
        needsPty: false,
        mergeStderr: true,
      },
      {
        id: 'claude',
        label: 'Claude Agent',
        available: false,
        needsPty: true,
        mergeStderr: false,
      },
    ],
  })
  listAgents(_req: Request, res: Response) {
    const agents = listAgents();
    const agentList = agents.map((agent: Agent) => ({
      id: agent.id,
      label: agent.label,
      defaultModel: this.agentModels?.[agent.id]?.defaultModel || agent.defaultModel,
      available: isAgentInstalled(agent.id),
      needsPty: agent.needsPty,
      mergeStderr: agent.mergeStderr,
    }));
    res.json(agentList);
  }

  @Get('/queue/status')
  @Summary('Queue status')
  @Description('Returns the current status of the task queue')
  @Tags(CORE_PLUGIN_TAG)
  @OpenApiResponse(200, 'Success', {
    example: { status: 'ok', message: 'Queue status not yet implemented' },
  })
  getQueueStatus(_req: Request, res: Response) {
    res.json({ status: 'ok', message: 'Queue status not yet implemented' });
  }

  @Post('/agent/run')
  @Summary('Run AI agent')
  @Description('Executes an AI agent with the provided prompt and options')
  @Tags(CORE_PLUGIN_TAG)
  @RequestBody({
    description: 'Agent run request with agentId, prompt, and optional options',
    required: true,
    example: {
      agentId: 'opencode',
      prompt: 'Analyze the repository and suggest improvements',
      options: {
        model: 'claude-3-5-sonnet',
        repoPath: '/path/to/repo',
      },
    },
    schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The ID of the agent to run' },
        prompt: { type: 'string', description: 'The prompt to send to the agent' },
        options: {
          type: 'object',
          properties: {
            model: { type: 'string' },
            repoPath: { type: 'string' },
            cwd: { type: 'string' },
          },
        },
      },
      required: ['agentId', 'prompt'],
    },
  })
  @OpenApiResponse(200, 'Success', {
    example: {
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      output: 'Analysis complete...',
      sawJson: false,
    },
  })
  @OpenApiResponse(400, 'Bad Request - agentId and prompt are required')
  @OpenApiResponse(404, 'Agent not found or not installed')
  @OpenApiResponse(503, 'Agent runner not available')
  async runAgent(req: Request, res: Response) {
    const body = req.body as AgentRunRequest;
    const { agentId, prompt, options } = body;

    if (!agentId || !prompt) {
      res.status(400).json({ error: 'agentId and prompt are required' });
      return;
    }

    if (!this.agentRunner) {
      res.status(503).json({ error: 'Agent runner not available' });
      return;
    }

    if (!isKnownAgent(agentId)) {
      const availableAgents = listAgents().map((a: Agent) => a.id);
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
        await this.agentRunner.runAgentForChat(taskId, prompt, {
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
        const output = await this.agentRunner.runAgentForChat(taskId, prompt, {
          agentId,
          repoPath: options?.repoPath,
          cwd: options?.cwd,
        });
        res.json({ taskId, output, sawJson: false });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    }
  }

  @Post('/events')
  @Summary('Process event')
  @Description('Processes a TaskEvent and executes the appropriate agent')
  @Tags(CORE_PLUGIN_TAG)
  @RequestBody({
    description: 'Event data containing type, message, and optional context',
    required: true,
    example: {
      type: 'question',
      message: 'What files were changed in the last commit?',
      context: {
        repoPath: '/path/to/repo',
        cwd: '/path/to/repo',
        threadId: null,
        model: 'claude-3-5-sonnet',
      },
    },
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['incident', 'question', 'command'] },
        message: { type: 'string' },
        context: {
          type: 'object',
          properties: {
            repoPath: { type: 'string', nullable: true },
            threadId: { type: 'string', nullable: true },
            cwd: { type: 'string' },
            model: { type: 'string' },
          },
        },
      },
      required: ['type', 'message'],
    },
  })
  @OpenApiResponse(200, 'Event queued', { example: { taskId: '550e8400-e29b-41d4-a716-446655440000' } })
  @OpenApiResponse(400, 'Invalid event - type and message are required')
  @OpenApiResponse(503, 'Agent runner or queue not available')
  async processEvent(req: Request, res: Response) {
    const body = req.body;
    const taskId = randomUUID();

    if (!body.type || !body.message) {
      res.status(400).json({ error: 'Invalid event: type and message are required' });
      return;
    }

    if (!this.agentRunner || !this.enqueue) {
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
        await this.enqueue(taskId, async () => {
          res.write(`data: ${JSON.stringify({ type: 'progress', content: `Processing event ${taskId}...` })}\n\n`);

          await this.agentRunner!.runAgentForChat(taskId, body.message, {
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
        await this.enqueue(taskId, async () => {
          await this.agentRunner!.runAgentForChat(taskId, body.message, {
            repoPath: body.context?.repoPath,
            cwd: body.context?.cwd || process.cwd(),
          });
        });
        res.json({ taskId });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    }
  }
}

export function createCoreApiController(deps: CoreApiControllerDeps): CoreApiController {
  return new CoreApiController(deps);
}
