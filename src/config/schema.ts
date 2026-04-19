import { z } from 'zod';

const pluginEntrySchema = z
  .object({
    package: z.string().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * Validated application config (files + env whitelist). Unknown top-level keys are preserved for forward compatibility.
 */
export const appConfigSchema = z
  .object({
    port: z.number().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    agents: z
      .record(
        z.string(),
        z.object({
          defaultModel: z.string().optional(),
        })
      )
      .optional(),
    plugins: z.array(pluginEntrySchema).optional(),
    adapters: z.record(z.string(), z.unknown()).optional(),
    observability: z.record(z.string(), z.unknown()).optional(),
    docsAuthRequired: z.boolean().optional(),
    docsApiKey: z.string().optional(),
  })
  .passthrough();

export type AppConfig = z.infer<typeof appConfigSchema>;
