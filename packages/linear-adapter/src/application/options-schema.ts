import * as z from 'zod';

/**
 * Linear adapter plugin options. Disabled by default until explicitly enabled.
 */
export const linearAdapterOptionsSchema = z
  .object({
    enabled: z.boolean().default(false),
    mockMode: z.boolean().default(true),
    /** Linear API key for GraphQL when {@link mockMode} is false. */
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
     * When true, accepts webhooks without a valid signature (local dev only).
     */
    skipWebhookSignatureVerification: z.boolean().default(false),
  })
  .strict();

export type LinearAdapterConfig = z.infer<typeof linearAdapterOptionsSchema>;
