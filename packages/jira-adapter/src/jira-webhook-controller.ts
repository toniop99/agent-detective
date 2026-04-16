import type { Request, Response } from 'express';
import {
  Controller,
  Post,
  Summary,
  Description,
  Tags,
  Response as OpenApiResponse,
  RequestBody,
} from '@agent-detective/core';
import type { JiraWebhookResponse } from './webhook-types.js';
import type { Logger } from '@agent-detective/types';

type JiraWebhookHandler = ReturnType<typeof import('./webhook-handler.js').createJiraWebhookHandler>;

const PLUGIN_TAG = '@agent-detective/jira-adapter';

@Controller('/webhook/jira', { tags: [PLUGIN_TAG], description: 'Jira webhook endpoints' })
export class JiraWebhookController {
  private webhookHandler?: JiraWebhookHandler;
  private logger?: Logger;

  setWebhookHandler(handler: JiraWebhookHandler): void {
    this.webhookHandler = handler;
  }

  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  @Post('/')
  @Summary('Handle Jira webhook')
  @Description('Receives and processes Jira webhook events for issue created, updated, or deleted')
  @Tags(PLUGIN_TAG)
  @RequestBody({
    description: 'Jira webhook payload containing event information',
    required: true,
    example: {
      webhookEvent: 'jira:issue_created',
      timestamp: 1713222000000,
      issue: {
        id: '12345',
        key: 'PROJ-123',
        fields: {
          summary: 'Bug in user login',
          description: 'Users are unable to login with SSO',
          issuetype: {
            id: '1',
            name: 'Bug',
            subtask: false,
          },
          priority: {
            id: '3',
            name: 'High',
          },
          status: {
            id: '1',
            name: 'Open',
            statusCategory: {
              id: '2',
              key: 'new',
              name: 'To Do',
            },
          },
          project: {
            id: '10000',
            key: 'PROJ',
            name: 'My Project',
          },
          assignee: {
            accountId: 'user123',
            displayName: 'John Developer',
            emailAddress: 'john@example.com',
            active: true,
          },
          reporter: {
            accountId: 'user456',
            displayName: 'Jane Reporter',
            emailAddress: 'jane@example.com',
            active: true,
          },
          labels: ['bug', 'login', 'sso'],
          created: '2026-04-01T10:00:00.000Z',
          updated: '2026-04-15T14:30:00.000Z',
        },
      },
      user: {
        accountId: 'user456',
        displayName: 'Jane Reporter',
        emailAddress: 'jane@example.com',
        active: true,
      },
    },
    schema: {
      type: 'object',
      properties: {
        webhookEvent: { type: 'string', description: 'The type of Jira event' },
        timestamp: { type: 'number', description: 'Event timestamp in milliseconds' },
        issue: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            key: { type: 'string' },
            fields: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
                description: { type: 'string', nullable: true },
                issuetype: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    subtask: { type: 'boolean' },
                  },
                },
                priority: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
                status: { type: 'object' },
                project: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    key: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
                assignee: { type: 'object', nullable: true },
                reporter: { type: 'object', nullable: true },
                labels: { type: 'array', items: { type: 'string' } },
                created: { type: 'string' },
                updated: { type: 'string' },
              },
            },
          },
        },
        user: { type: 'object' },
      },
    },
  })
  @OpenApiResponse(200, 'Success', {
    example: {
      status: 'success',
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      message: 'Issue PROJ-123 queued for analysis',
    },
  })
  @OpenApiResponse(200, 'Ignored', {
    example: {
      status: 'ignored',
      message: 'Event jira:issue_deleted not configured for processing',
    },
  })
  @OpenApiResponse(500, 'Error processing webhook', {
    example: {
      status: 'error',
      message: 'Failed to process webhook: Invalid payload',
    },
  })
  async handleWebhook(req: Request, res: Response): Promise<void> {
    if (!this.webhookHandler) {
      res.status(503).json({ status: 'error', message: 'Webhook handler not available' } as JiraWebhookResponse);
      return;
    }

    try {
      const webhookEvent = req.body?.webhookEvent || 'unknown';
      const result = await this.webhookHandler.handleWebhook(req.body, webhookEvent);
      res.json(result);
    } catch (err) {
      this.logger?.error(`Jira webhook error: ${(err as Error).message}`);
      res.status(500).json({ status: 'error', message: (err as Error).message } as JiraWebhookResponse);
    }
  }
}
