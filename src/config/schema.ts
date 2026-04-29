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
    /**
     * Operator guardrails for orchestrated tasks (webhook-driven and similar).
     * `maxConcurrent` wraps the default in-memory task queue so at most N agent
     * runs execute at once across all queue keys. `maxWallTimeMs` caps a single
     * orchestrated `runAgentForChat` call (the subprocess may still shut down
     * on its own schedule — see agent `agents.runner.timeoutMs`).
     */
    tasks: z
      .object({
        maxConcurrent: z.number().int().positive().max(1000).optional(),
        maxWallTimeMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    /**
     * When set, each task lifecycle line (start / completed / failed) is appended
     * as one JSON object per line (JSONL) to `path` (absolute or relative to the
     * config directory).
     */
    runRecords: z
      .object({
        path: z.string().min(1),
      })
      .strict()
      .optional(),
    /**
     * Host SQLite persistence (`node:sqlite`). When `enabled` is true, `databasePath` is required
     * (absolute or relative to the config directory — same resolution as `runRecords.path`).
     */
    persistence: z
      .object({
        enabled: z.boolean(),
        databasePath: z.string().min(1).optional(),
      })
      .strict()
      .optional()
      .superRefine((p, ctx) => {
        if (!p) return;
        if (p.enabled === true && (!p.databasePath || p.databasePath.trim().length === 0)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'persistence.databasePath is required when persistence.enabled is true',
            path: ['databasePath'],
          });
        }
      }),
    docsAuthRequired: z.boolean().optional(),
    docsApiKey: z.string().optional(),
  })
  .strict();

export type AppConfig = z.infer<typeof appConfigSchema>;
