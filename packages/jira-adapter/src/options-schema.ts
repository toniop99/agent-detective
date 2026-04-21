import { z } from 'zod';
import type { JiraWebhookBehavior } from './types.js';

export const DEFAULT_WEBHOOK_BEHAVIOR: JiraWebhookBehavior = {
  defaults: {
    action: 'ignore',
    acknowledgmentMessage: 'Thanks for the update! I will review this issue and provide feedback shortly.',
  },
  events: {
    'jira:issue_created': { action: 'analyze' },
    // `analyze` on `jira:comment_created` is the manual retry mechanism:
    // if the initial create had no matching label, the adapter posts a
    // reminder asking for a label + a trigger comment. When the user later
    // comments with `retryTriggerPhrase` in it, the matcher runs again
    // against the ticket's current labels.
    'jira:comment_created': { action: 'analyze' },
  },
};

const jiraWebhookEventTypeSchema = z.enum([
  'jira:issue_created',
  'jira:issue_updated',
  'jira:issue_deleted',
  'jira:comment_created',
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
    /**
     * Markdown template posted to Jira when an `issue_created` event arrives
     * but none of the labels match a configured repo. See
     * `handlers/missing-labels-handler.ts` for supported placeholders.
     */
    missingLabelsMessage: z.string().optional(),
    /**
     * Safety cap for multi-repo fan-out. When an issue's labels match more
     * than this many configured repos, the adapter analyzes the first N
     * (repo-config order) and mentions the skipped ones in the acknowledgment.
     * `0` disables the cap.
     */
    maxReposPerIssue: z.number().int().min(0).default(5),
    /**
     * Phrase that, when found inside a Jira comment by a non-adapter user,
     * triggers a fresh label match + analysis. Matching is case-insensitive
     * and substring-based. Default is a slash/hashtag command-style phrase
     * that is extremely unlikely to appear in normal conversation.
     */
    retryTriggerPhrase: z.string().min(1).default('#agent-detective analyze'),
    /**
     * Identity of the Jira account the adapter posts as. Combined with the
     * hidden marker the adapter stamps on every comment, this is used to
     * ignore comments the adapter itself authored so result / reminder
     * comments can't re-trigger analysis.
     */
    jiraUser: z
      .object({
        accountId: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
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
