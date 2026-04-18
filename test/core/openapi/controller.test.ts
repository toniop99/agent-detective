import 'reflect-metadata';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import {
  Controller,
  registerController,
  registerControllers,
  getRegisteredRoutes,
  getControllerMetadata,
  getControllerRoutes,
  Get,
  Post,
  Delete,
  Summary,
  Response,
} from '@agent-detective/core';

describe('Controller decorator', () => {
  @Controller('/test-prefix', { tags: ['test-controller'], description: 'Test controller' })
  class TestController {
    @Get('/items')
    getItems() {}

    @Post('/items')
    @Summary('Create item')
    createItem() {}
  }

  it('stores controller metadata with prefix', () => {
    const meta = getControllerMetadata(TestController);
    assert.ok(meta);
    assert.equal(meta.prefix, '/test-prefix');
  });

  it('stores controller tags', () => {
    const meta = getControllerMetadata(TestController);
    assert.ok(meta);
    assert.deepEqual(meta.tags, ['test-controller']);
  });

  it('stores controller description', () => {
    const meta = getControllerMetadata(TestController);
    assert.ok(meta);
    assert.equal(meta.description, 'Test controller');
  });

  it('getControllerRoutes returns decorated routes', () => {
    const routes = getControllerRoutes(TestController);
    assert.equal(routes.length, 2);
    assert.equal(routes[0].method, 'get');
    assert.equal(routes[0].path, '/items');
    assert.equal(routes[1].method, 'post');
    assert.equal(routes[1].path, '/items');
  });

  it('routes include operation metadata', () => {
    const routes = getControllerRoutes(TestController);
    const createRoute = routes.find(r => r.method === 'post');
    assert.ok(createRoute);
    assert.ok(createRoute.operationMetadata);
    assert.equal(createRoute.operationMetadata.summary, 'Create item');
  });

  it('getRegisteredRoutes returns full path with prefix', () => {
    const routes = getRegisteredRoutes(TestController);
    assert.equal(routes.length, 2);
    assert.equal(routes[0].path, '/test-prefix/items');
    assert.equal(routes[1].path, '/test-prefix/items');
  });
});

describe('registerController', () => {
  let app: express.Application;
  let testRouter: Record<string, unknown[]>;

  beforeEach(() => {
    app = express();
    testRouter = {};
    app.use((path: string, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
      testRouter[path] = testRouter[path] || [];
      testRouter[path].push('middleware');
      next();
    });
  });

  @Controller('/api/users')
  class UserController {
    @Get('/')
    listUsers() {}

    @Post('/')
    @Summary('Create user')
    createUser() {}

    @Get('/:id')
    getUser() {}

    @Delete('/:id')
    deleteUser() {}
  }

  it('registers all routes from controller', () => {
    registerController(app, UserController);

    const routes = getRegisteredRoutes(UserController);
    assert.equal(routes.length, 4);

    assert.equal(routes[0].method, 'get');
    assert.equal(routes[0].path, '/api/users/');

    assert.equal(routes[1].method, 'post');
    assert.equal(routes[1].path, '/api/users/');

    assert.equal(routes[2].method, 'get');
    assert.equal(routes[2].path, '/api/users/:id');

    assert.equal(routes[3].method, 'delete');
    assert.equal(routes[3].path, '/api/users/:id');
  });

  it('routes have handler functions', () => {
    registerController(app, UserController);

    const routes = getRegisteredRoutes(UserController);
    for (const route of routes) {
      assert.ok(route.handler);
      assert.equal(typeof route.handler, 'function');
    }
  });
});

describe('registerControllers', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
  });

  @Controller('/controller-a')
  class ControllerA {
    @Get('/route')
    routeA() {}
  }

  @Controller('/controller-b')
  class ControllerB {
    @Get('/route')
    routeB() {}
  }

  it('registers routes from multiple controllers', () => {
    registerControllers(app, [ControllerA, ControllerB]);

    const routesA = getRegisteredRoutes(ControllerA);
    const routesB = getRegisteredRoutes(ControllerB);

    assert.equal(routesA.length, 1);
    assert.equal(routesA[0].path, '/controller-a/route');

    assert.equal(routesB.length, 1);
    assert.equal(routesB[0].path, '/controller-b/route');
  });
});

describe('Controller without prefix', () => {
  @Controller('')
  class NoPrefixController {
    @Get('/simple')
    simpleRoute() {}
  }

  it('works with empty prefix', () => {
    const meta = getControllerMetadata(NoPrefixController);
    assert.ok(meta);
    assert.equal(meta.prefix, '');
  });

  it('returns route without leading slash prefix', () => {
    const routes = getRegisteredRoutes(NoPrefixController);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].path, '/simple');
  });
});

describe('Controller with multiple decorators', () => {
  @Controller('/multi')
  class MultiDecoratedController {
    @Get('/route')
    @Summary('Multi decorated route')
    @Response(200, 'OK')
    @Response(404, 'Not Found')
    multiDecoratedRoute() {}
  }

  it('combines metadata from multiple decorators', () => {
    const routes = getControllerRoutes(MultiDecoratedController);
    assert.equal(routes.length, 1);

    const route = routes[0];
    assert.ok(route.operationMetadata);
    assert.equal(route.operationMetadata.summary, 'Multi decorated route');
    assert.ok(route.operationMetadata.responses);
    assert.equal(route.operationMetadata.responses?.size, 2);
  });
});