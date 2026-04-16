import type { Request, Response } from 'express';
import {
  Controller,
  Get,
  Summary,
  Description,
  Tags,
  Response as OpenApiResponse,
} from '@agent-detective/core';
import type { LocalReposContext } from './types.js';

const PLUGIN_TAG = '@agent-detective/local-repos-plugin';

@Controller('/repos', { tags: [PLUGIN_TAG], description: 'Repository management endpoints' })
export class ReposController {
  private localRepos?: LocalReposContext;

  constructor(localRepos?: LocalReposContext) {
    this.localRepos = localRepos;
  }

  setLocalRepos(localRepos: LocalReposContext): void {
    this.localRepos = localRepos;
  }

  @Get('/')
  @Summary('List all repositories')
  @Description('Returns all configured repositories with their validation status, tech stack, and summaries')
  @Tags(PLUGIN_TAG)
  @OpenApiResponse(200, 'Success', {
    example: [
      {
        name: 'my-repo',
        path: '/path/to/my-repo',
        exists: true,
        description: 'My repository',
        techStack: ['typescript', 'node'],
        summary: 'A TypeScript project',
        commits: [
          {
            hash: 'abc123',
            message: 'Initial commit',
            author: 'Developer',
            email: 'dev@example.com',
            date: '2026-04-01T00:00:00.000Z',
          },
        ],
        lastChecked: '2026-04-16T00:00:00.000Z',
      },
    ],
  })
  listRepos(_req: Request, res: Response) {
    if (!this.localRepos) {
      res.status(503).json({ error: 'Local repos not available' });
      return;
    }
    res.json(this.localRepos.getAllRepos());
  }

  @Get('/:name')
  @Summary('Get repository by name')
  @Description('Returns a specific repository by its name')
  @Tags(PLUGIN_TAG)
  @OpenApiResponse(200, 'Success', {
    example: {
      name: 'my-repo',
      path: '/path/to/my-repo',
      exists: true,
      description: 'My repository',
      techStack: ['typescript', 'node'],
      summary: 'A TypeScript project',
      commits: [
        {
          hash: 'abc123',
          message: 'Initial commit',
          author: 'Developer',
          email: 'dev@example.com',
          date: '2026-04-01T00:00:00.000Z',
        },
      ],
      lastChecked: '2026-04-16T00:00:00.000Z',
    },
  })
  @OpenApiResponse(404, 'Repository not found')
  getRepo(req: Request, res: Response) {
    if (!this.localRepos) {
      res.status(503).json({ error: 'Local repos not available' });
      return;
    }
    const repo = this.localRepos.getRepo(req.params.name as string);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    res.json(repo);
  }
}
