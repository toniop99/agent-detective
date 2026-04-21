import { z } from 'zod';

const repoConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string().optional(),
  techStack: z.array(z.string()).optional(),
});

const techStackDetectionSchema = z
  .object({
    enabled: z.boolean().optional(),
    patterns: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict()
  .optional();

const summaryGenerationSchema = z
  .object({
    enabled: z.boolean().optional(),
    source: z.enum(['readme', 'commits', 'both']).optional(),
    maxReadmeLines: z.number().int().min(0).optional(),
    commitCount: z.number().int().min(0).optional(),
    useAgent: z.boolean().optional(),
    agentId: z.string().optional(),
    model: z.string().optional(),
    summaryPrompt: z.string().optional(),
    maxOutputChars: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

const validationSchema = z
  .object({
    failOnMissing: z.boolean().optional(),
  })
  .strict()
  .optional();

const repoContextSchema = z
  .object({
    gitLogMaxCommits: z.number().int().min(0).optional(),
    gitCommandTimeoutMs: z.number().int().min(0).optional(),
    gitMaxBufferBytes: z.number().int().min(0).optional(),
    diffFromRef: z.string().min(1).optional(),
  })
  .strict()
  .optional();

/** Zod schema for local-repos plugin options (validation + generated docs). */
export const localReposPluginOptionsSchema = z
  .object({
    repos: z.array(repoConfigSchema),
    techStackDetection: techStackDetectionSchema,
    summaryGeneration: summaryGenerationSchema,
    validation: validationSchema,
    repoContext: repoContextSchema,
  })
  .strict();

export type LocalReposPluginOptionsInferred = z.infer<typeof localReposPluginOptionsSchema>;
