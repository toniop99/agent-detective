import { z } from 'zod';
import type { JiraWebhookBehavior } from './types.js';

export const DEFAULT_WEBHOOK_BEHAVIOR: JiraWebhookBehavior = {
  defaults: {
    action: 'ignore',
    acknowledgmentMessage: 'Thanks for the update! I will review this issue and provide feedback shortly.',
  },
  events: {
    'jira:issue_created': { action: 'analyze' },
    'jira:issue_updated': { action: 'acknowledge' },
  },
};

const jiraWebhookEventTypeSchema = z.enum([
  'jira:issue_created',
  'jira:issue_updated',
  'jira:issue_deleted',
]);

const jiraEventConfigSchema = z.object({
  action: z.enum(['analyze', 'acknowledge', 'ignore']),
  analysisPrompt: z.string().optional(),
  acknowledgmentMessage: z.string().optional(),
});

const jiraWebhookBehaviorSchema = z.object({
  defaults: jiraEventConfigSchema,
  events: z.partialRecord(jiraWebhookEventTypeSchema, jiraEventConfigSchema.partial()).optional(),
});

const DEFAULT_WEBHOOK_PATH = '/plugins/agent-detective-jira-adapter/webhook/jira';

/** Zod schema for Jira adapter plugin options (single source of truth for validation and docs). */
export const jiraAdapterOptionsSchema = z
  .object({
    enabled: z.boolean().default(true),
    webhookPath: z.string().default(DEFAULT_WEBHOOK_PATH),
    mockMode: z.boolean().default(true),
    baseUrl: z.string().optional(),
    email: z.string().optional(),
    apiToken: z.string().optional(),
    analysisPrompt: z.string().optional(),
    analysisReadOnly: z.boolean().default(true),
    webhookBehavior: jiraWebhookBehaviorSchema.default(DEFAULT_WEBHOOK_BEHAVIOR),
  })
  .superRefine((data, ctx) => {
    if (data.mockMode !== false) return;
    const missing: string[] = [];
    if (!data.baseUrl?.trim()) missing.push('baseUrl');
    if (!data.email?.trim()) missing.push('email');
    if (!data.apiToken?.trim()) missing.push('apiToken');
    if (missing.length === 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `When mockMode is false, Jira Cloud REST requires: ${missing.join(', ')} (set in config or JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).`,
      path: ['mockMode'],
    });
  });

export type JiraAdapterOptions = z.infer<typeof jiraAdapterOptionsSchema>;
