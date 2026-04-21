import * as z from 'zod';

const pluginEntrySchema = z.looseObject({
  package: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

const agentsRunnerConfigSchema = z
  .object({
    timeoutMs: z.number().int().positive().optional(),
    maxBufferBytes: z.number().int().positive().optional(),
    postFinalGraceMs: z.number().int().nonnegative().optional(),
    forceKillDelayMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const agentModelConfigSchema = z
  .object({
    defaultModel: z.string().optional(),
  })
  .strict();

/** `agents` maps each agent id to model defaults; the special key `runner` holds process tuning for `createAgentRunner`. */
const agentsEntrySchema = z.union([agentModelConfigSchema, agentsRunnerConfigSchema]);

/**
 * Validated application config (files + env whitelist). Unknown top-level keys are preserved for forward compatibility.
 */
export const appConfigSchema = z.looseObject({
  port: z.number().optional(),
  agent: z.string().optional(),
  agents: z.record(z.string(), agentsEntrySchema).optional(),
  plugins: z.array(pluginEntrySchema).optional(),
  /** Merged into `createObservability` / request logger; `requestLogger.excludePaths` is read in `server.ts`. */
  observability: z.record(z.string(), z.unknown()).optional(),
  docsAuthRequired: z.boolean().optional(),
  docsApiKey: z.string().optional(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
