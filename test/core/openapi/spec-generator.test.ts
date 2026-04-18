import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  Controller,
  Get,
  Post,
  Summary,
  Description,
  Tags,
  Response,
  RequestBody,
  generateSpecFromControllers,
  generateSpecFromRoutes,
} from '@agent-detective/core';

describe('generateSpecFromControllers', () => {
  @Controller('/plugins/repos', { tags: ['local-repos-plugin'], description: 'Repository management' })
  class RepoController {
    @Get('/')
    @Summary('List repositories')
    @Description('Returns all available repositories')
    @Tags('repos', 'list')
    @Response(200, 'Success', { contentType: 'application/json' })
    listRepos() {}

    @Get('/:name')
    @Summary('Get repository')
    @Description('Returns a single repository by name')
    getRepo() {}

    @Post('/')
    @Summary('Create repository')
    @RequestBody({ description: 'Repository configuration', required: true })
    createRepo() {}
  }

  it('generates valid OpenAPI 3.0 spec', () => {
    const spec = generateSpecFromControllers([RepoController]);
    assert.equal(spec.openapi, '3.0.0');
    assert.ok(spec.info);
    assert.equal(spec.info.title, 'Agent Detective API');
  });

  it('creates paths for all routes', () => {
    const spec = generateSpecFromControllers([RepoController]);
    assert.ok(spec.paths);
    assert.ok(spec.paths['/plugins/repos/']);
    assert.ok(spec.paths['/plugins/repos/:name']);
  });

  it('includes operation-level metadata', () => {
    const spec = generateSpecFromControllers([RepoController]);
    const listOp = spec.paths['/plugins/repos/'].get;
    assert.ok(listOp);
    assert.equal(listOp.summary, 'List repositories');
    assert.equal(listOp.description, 'Returns all available repositories');
  });

  it('includes tags from controller and operation', () => {
    const spec = generateSpecFromControllers([RepoController]);
    const listOp = spec.paths['/plugins/repos/'].get;
    assert.ok(listOp.tags);
    assert.ok(listOp.tags.includes('repos'));
    assert.ok(listOp.tags.includes('list'));
  });

  it('generates tags array with descriptions', () => {
    const spec = generateSpecFromControllers([RepoController]);
    assert.ok(spec.tags);
    const repoTag = spec.tags.find(t => t.name === 'local-repos-plugin');
    assert.ok(repoTag);
    assert.equal(repoTag.description, 'Repository management');
  });

  it('includes response information', () => {
    const spec = generateSpecFromControllers([RepoController]);
    const listOp = spec.paths['/plugins/repos/'].get;
    assert.ok(listOp.responses);
    assert.ok(listOp.responses['200']);
  });

  it('includes requestBody for POST', () => {
    const spec = generateSpecFromControllers([RepoController]);
    const createOp = spec.paths['/plugins/repos/'].post;
    assert.ok(createOp.requestBody);
    assert.equal(createOp.requestBody.description, 'Repository configuration');
    assert.equal(createOp.requestBody.required, true);
  });

  it('includes x-tagGroups for Scalar', () => {
    const spec = generateSpecFromControllers([RepoController]);
    assert.ok(spec['x-tagGroups']);
    assert.ok(Array.isArray(spec['x-tagGroups']));
  });
});

describe('generateSpecFromRoutes', () => {
  it('generates spec from CapturedRoute array', () => {
    const routes = [
      {
        method: 'get',
        path: '/health',
        prefixedPath: '/api/health',
        pluginName: '@agent-detective/core',
      },
      {
        method: 'post',
        path: '/events',
        prefixedPath: '/api/events',
        pluginName: '@agent-detective/core',
      },
    ];

    const spec = generateSpecFromRoutes(routes);
    assert.equal(spec.openapi, '3.0.0');
    assert.ok(spec.paths['/api/health']);
    assert.ok(spec.paths['/api/events']);
  });

  it('adds tags based on pluginName', () => {
    const routes = [
      {
        method: 'get',
        path: '/repos',
        prefixedPath: '/plugins/test-plugin/repos',
        pluginName: 'test-plugin',
      },
    ];

    const spec = generateSpecFromRoutes(routes);
    const op = spec.paths['/plugins/test-plugin/repos'].get;
    assert.ok(op.tags);
    assert.ok(op.tags.includes('test-plugin'));
  });

  it('includes tags array in spec', () => {
    const routes = [
      {
        method: 'get',
        path: '/repos',
        prefixedPath: '/plugins/test-plugin/repos',
        pluginName: 'test-plugin',
      },
    ];

    const spec = generateSpecFromRoutes(routes);
    assert.ok(spec.tags);
    const tag = spec.tags.find(t => t.name === 'test-plugin');
    assert.ok(tag);
  });

  it('adds default summary from route info', () => {
    const routes = [
      {
        method: 'get',
        path: '/health',
        prefixedPath: '/api/health',
        pluginName: '@agent-detective/core',
      },
    ];

    const spec = generateSpecFromRoutes(routes);
    const op = spec.paths['/api/health'].get;
    assert.ok(op.summary);
    assert.ok(op.summary.includes('GET'));
  });

  it('converts Express path params to OpenAPI format', () => {
    const routes = [
      {
        method: 'get',
        path: '/repos/:name',
        prefixedPath: '/api/repos/:name',
        pluginName: '@agent-detective/core',
      },
    ];

    const spec = generateSpecFromRoutes(routes);
    assert.ok(spec.paths['/api/repos/{name}']);
  });

  it('uses operationMetadata when provided', () => {
    const routes = [
      {
        method: 'get',
        path: '/repos',
        prefixedPath: '/api/repos',
        pluginName: '@agent-detective/core',
        operationMetadata: {
          summary: 'Custom summary',
          description: 'Custom description',
        },
      },
    ];

    const spec = generateSpecFromRoutes(routes);
    const op = spec.paths['/api/repos'].get;
    assert.equal(op.summary, 'Custom summary');
    assert.equal(op.description, 'Custom description');
  });

  it('includes server entry', () => {
    const spec = generateSpecFromRoutes([]);
    assert.ok(spec.servers);
    assert.equal(spec.servers[0].url, '/');
    assert.equal(spec.servers[0].description, 'Current server');
  });

  it('handles empty routes array', () => {
    const spec = generateSpecFromRoutes([]);
    assert.deepEqual(spec.paths, {});
    assert.ok(spec.tags);
  });

  it('includes x-tagGroups for Scalar', () => {
    const routes = [
      {
        method: 'get',
        path: '/health',
        prefixedPath: '/api/health',
        pluginName: '@agent-detective/core',
      },
    ];

    const spec = generateSpecFromRoutes(routes);
    assert.ok(spec['x-tagGroups']);
    assert.ok(Array.isArray(spec['x-tagGroups']));
  });
});

describe('Spec with custom info', () => {
  it('uses custom title when provided', () => {
    const spec = generateSpecFromControllers([], { title: 'Custom API' });
    assert.equal(spec.info.title, 'Custom API');
  });

  it('uses custom version when provided', () => {
    const spec = generateSpecFromControllers([], { version: '2.0.0' });
    assert.equal(spec.info.version, '2.0.0');
  });

  it('uses custom description when provided', () => {
    const spec = generateSpecFromControllers([], { description: 'Custom description' });
    assert.equal(spec.info.description, 'Custom description');
  });
});