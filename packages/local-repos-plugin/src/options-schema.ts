import { z } from 'zod';

const repoConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string().optional(),
  techStack: z.array(z.string()).optional(),
});

/** Zod schema for local-repos plugin options (validation + generated docs). */
export const localReposPluginOptionsSchema = z.object({
  repos: z.array(repoConfigSchema),
  techStackDetection: z.record(z.string(), z.unknown()).optional(),
  summaryGeneration: z.record(z.string(), z.unknown()).optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
  repoContext: z
    .object({
      gitLogMaxCommits: z.number().optional(),
    })
    .optional(),
  discovery: z.record(z.string(), z.unknown()).optional(),
  discoveryContext: z.record(z.string(), z.unknown()).optional(),
});

export type LocalReposPluginOptionsInferred = z.infer<typeof localReposPluginOptionsSchema>;
