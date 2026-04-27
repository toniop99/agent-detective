import * as z from 'zod';

export const DEFAULT_LINEAR_WEBHOOK_BEHAVIOR = {
  defaults: {
    action: 'ignore',
    acknowledgmentMessage:
      'Thanks for the update! I will review this issue and provide feedback shortly.',
  },
  events: {
    'linear:Issue:create': { action: 'analyze' },
    'linear:Comment:create': { action: 'analyze' },
  },
} as const;

const linearEventConfigSchema = z.object({
  action: z.enum(['analyze', 'acknowledge', 'ignore']),
  analysisPrompt: z.string().optional(),
  acknowledgmentMessage: z.string().optional(),
});

const linearWebhookBehaviorSchema = z.object({
  defaults: linearEventConfigSchema,
  events: z.record(z.string(), linearEventConfigSchema.partial()).optional(),
});

/**
 * Linear adapter plugin options. Disabled by default until explicitly enabled.
 */
export const linearAdapterOptionsSchema = z
  .object({
    enabled: z.boolean().default(false),
    mockMode: z.boolean().default(true),
    /** Linear API key (or OAuth access token) for GraphQL. Required when the plugin is enabled. */
    apiKey: z.string().optional(),
    /**
     * Webhook signing secret from Linear. When set (and
     * {@link skipWebhookSignatureVerification} is false), POST /webhook/linear
     * verifies `Linear-Signature` against the raw body.
     */
    webhookSigningSecret: z.string().optional(),
    /** OAuth app client id (install / callback flow; optional in Phase B). */
    oauthClientId: z.string().optional(),
    /** OAuth app client secret. Prefer env via {@link applyPluginEnvWhitelist}. */
    oauthClientSecret: z.string().optional(),
    /**
     * Public base URL of this host (no trailing slash), used to build the OAuth redirect URI:
     * `{oauthRedirectBaseUrl}/plugins/agent-detective-linear-adapter/oauth/callback`.
     */
    oauthRedirectBaseUrl: z.string().optional(),
    /** OAuth scopes for `/oauth/start` (Linear space-separated). Default: `read,write`. */
    oauthScopes: z.string().optional(),
    /**
     * When true, accepts webhooks without a valid signature (local dev only).
     */
    skipWebhookSignatureVerification: z.boolean().default(false),
    webhookBehavior: linearWebhookBehaviorSchema.default(DEFAULT_LINEAR_WEBHOOK_BEHAVIOR),
    analysisPrompt: z.string().optional(),
    /**
     * When true (default), analysis tasks are read-only (`readOnly` in task metadata).
     */
    analysisReadOnly: z.boolean().default(true),
    missingLabelsMessage: z.string().optional(),
    maxReposPerIssue: z.number().int().min(0).default(5),
    retryTriggerPhrase: z.string().min(1).default('#agent-detective analyze'),
    prTriggerPhrase: z.string().min(1).default('#agent-detective pr'),
    /**
     * Linear `actor.id` values treated as the integration itself (loop protection
     * in addition to the stamped marker in comment bodies).
     */
    botActorIds: z.array(z.string()).optional(),
    autoAnalysisCooldownMs: z.number().int().min(0).default(10 * 60_000),
    missingLabelsReminderCooldownMs: z.number().int().min(0).default(60_000),
    /** When true, PR workflow includes human Linear comments (filtered like Jira). */
    fetchIssueComments: z.boolean().default(false),
  })
  .strict();

export type LinearAdapterConfig = z.infer<typeof linearAdapterOptionsSchema>;
