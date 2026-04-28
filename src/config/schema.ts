import * as z from 'zod';

const pluginEntrySchema = z
  .object({
  package: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
})
  .strict();

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
 * Validated application config (files + env whitelist).
 */
export const appConfigSchema = z
  .object({
    port: z.number().optional(),
    agent: z.string().optional(),
    agents: z.record(z.string(), agentsEntrySchema).optional(),
    plugins: z.array(pluginEntrySchema).optional(),
    pluginSystem: z
      .object({
        /**
         * When true, the host aborts startup if plugin contract validation
         * detects missing capability-backed providers (e.g. requires capability
         * but no mapped service is registered).
         */
        failOnContractErrors: z.boolean().optional(),
        /**
         * When true, the host aborts startup if plugin dependency resolution
         * detects missing dependencies or circular cycles.
         */
        failOnDependencyErrors: z.boolean().optional(),
        /**
         * When true, the host aborts startup if any configured plugin fails
         * to import, validate, or register.
         */
        failOnPluginLoadErrors: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Merged into `createObservability` / request logger; `requestLogger.excludePaths` is read in `server.ts`. */
    observability: z.record(z.string(), z.unknown()).optional(),
    docsAuthRequired: z.boolean().optional(),
    docsApiKey: z.string().optional(),
  })
  .strict();

export type AppConfig = z.infer<typeof appConfigSchema>;
