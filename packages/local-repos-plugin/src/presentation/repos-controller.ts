import { z } from 'zod';
import {
  defineRoute,
  registerRoutes,
  type RouteDefinition,
} from '@agent-detective/core';
import type { FastifyInstance } from 'fastify';
import type { LocalReposContext } from '../domain/types.js';

const PLUGIN_TAG = '@agent-detective/local-repos-plugin';

const ValidatedRepoSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    exists: z.boolean(),
    description: z.string().optional(),
    techStack: z.array(z.string()).optional(),
    summary: z.string().optional(),
    commits: z.array(z.unknown()).optional(),
    lastChecked: z.union([z.string(), z.date()]).optional(),
  })
  .passthrough();

const ReposListResponse = z.array(ValidatedRepoSchema);

const ErrorResponse = z.object({ error: z.string() });

const RepoNameParams = z.object({ name: z.string().min(1) });

/**
 * Returns the route table for the local-repos plugin. The plugin wires the
 * `LocalReposContext` here at register time so handlers stay pure
 * `defineRoute` records.
 */
export function buildReposRoutes(localRepos: LocalReposContext): RouteDefinition[] {
  const listRepos = defineRoute({
    method: 'GET',
    url: '/repos',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'List all repositories',
      description:
        'Returns all configured repositories with their validation status, tech stack, and summaries',
      response: { 200: ReposListResponse },
    },
    handler() {
      return localRepos.getAllRepos();
    },
  });

  const getRepo = defineRoute({
    method: 'GET',
    url: '/repos/:name',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Get repository by name',
      description: 'Returns a specific repository by its name',
      params: RepoNameParams,
      response: { 200: ValidatedRepoSchema, 404: ErrorResponse },
    },
    handler(req, reply) {
      const { name } = req.params as z.infer<typeof RepoNameParams>;
      const repo = localRepos.getRepo(name);
      if (!repo) {
        return reply.code(404).send({ error: 'Repo not found' });
      }
      return repo;
    },
  });

  return [listRepos, getRepo];
}

export function registerReposRoutes(app: FastifyInstance, localRepos: LocalReposContext): void {
  registerRoutes(app, buildReposRoutes(localRepos));
}
