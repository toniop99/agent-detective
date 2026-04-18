import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Summary,
  Description,
  Tags,
  OperationId,
  Deprecated,
  Security,
  RequestBody,
  Response,
  PathParam,
  QueryParam,
  HeaderParam,
  Body,
  getRouteMetadata,
  getOperationMetadata,
} from '@agent-detective/core';

describe('HTTP Method Decorators', () => {
  class TestController {
    @Get('/test')
    getTest() {}

    @Post('/test')
    postTest() {}

    @Put('/test')
    putTest() {}

    @Delete('/test')
    deleteTest() {}

    @Patch('/test')
    patchTest() {}
  }

  it('@Get sets route metadata with method "get"', () => {
    const meta = getRouteMetadata(TestController.prototype, 'getTest');
    assert.ok(meta);
    assert.equal(meta.method, 'get');
    assert.equal(meta.path, '/test');
  });

  it('@Post sets route metadata with method "post"', () => {
    const meta = getRouteMetadata(TestController.prototype, 'postTest');
    assert.ok(meta);
    assert.equal(meta.method, 'post');
    assert.equal(meta.path, '/test');
  });

  it('@Put sets route metadata with method "put"', () => {
    const meta = getRouteMetadata(TestController.prototype, 'putTest');
    assert.ok(meta);
    assert.equal(meta.method, 'put');
    assert.equal(meta.path, '/test');
  });

  it('@Delete sets route metadata with method "delete"', () => {
    const meta = getRouteMetadata(TestController.prototype, 'deleteTest');
    assert.ok(meta);
    assert.equal(meta.method, 'delete');
    assert.equal(meta.path, '/test');
  });

  it('@Patch sets route metadata with method "patch"', () => {
    const meta = getRouteMetadata(TestController.prototype, 'patchTest');
    assert.ok(meta);
    assert.equal(meta.method, 'patch');
    assert.equal(meta.path, '/test');
  });
});

describe('OpenAPI Decorators', () => {
  class TestController {
    @Get('/summary')
    @Summary('Test summary')
    getSummary() {}

    @Get('/description')
    @Description('Test description text')
    getDescription() {}

    @Get('/tags')
    @Tags('tag1', 'tag2', 'tag3')
    getTags() {}

    @Get('/operation')
    @OperationId('custom-operation-id')
    getOperationId() {}

    @Get('/deprecated')
    @Deprecated()
    getDeprecated() {}

    @Get('/security')
    @Security('apiKey')
    getSecurity() {}
  }

  it('@Summary stores summary string', () => {
    const meta = getOperationMetadata(TestController.prototype, 'getSummary');
    assert.ok(meta);
    assert.equal(meta.summary, 'Test summary');
  });

  it('@Description stores description string', () => {
    const meta = getOperationMetadata(TestController.prototype, 'getDescription');
    assert.ok(meta);
    assert.equal(meta.description, 'Test description text');
  });

  it('@Tags stores multiple tags as array', () => {
    const meta = getOperationMetadata(TestController.prototype, 'getTags');
    assert.ok(meta);
    assert.deepEqual(meta.tags, ['tag1', 'tag2', 'tag3']);
  });

  it('@OperationId stores operation ID', () => {
    const meta = getOperationMetadata(TestController.prototype, 'getOperationId');
    assert.ok(meta);
    assert.equal(meta.operationId, 'custom-operation-id');
  });

  it('@Deprecated sets deprecated flag to true', () => {
    const meta = getOperationMetadata(TestController.prototype, 'getDeprecated');
    assert.ok(meta);
    assert.equal(meta?.deprecated, true);
  });

  it('@Security stores security scheme', () => {
    const meta = getOperationMetadata(TestController.prototype, 'getSecurity');
    assert.ok(meta);
    assert.deepEqual(meta.security, ['apiKey']);
  });
});

describe('@RequestBody decorator', () => {
  class TestController {
    @Post('/with-body')
    @RequestBody({ description: 'User data', required: true })
    withRequestBody() {}

    @Post('/optional-body')
    @RequestBody({ description: 'Optional data', required: false })
    optionalBody() {}
  }

  it('stores request body metadata with description and required', () => {
    const meta = getOperationMetadata(TestController.prototype, 'withRequestBody');
    assert.ok(meta);
    assert.ok(meta.requestBody);
    assert.equal(meta.requestBody.description, 'User data');
    assert.equal(meta.requestBody.required, true);
  });

  it('defaults required to true when not specified', () => {
    const meta = getOperationMetadata(TestController.prototype, 'withRequestBody');
    assert.ok(meta);
    assert.ok(meta?.requestBody);
  });

  it('stores optional request body', () => {
    const meta = getOperationMetadata(TestController.prototype, 'optionalBody');
    assert.ok(meta);
    assert.ok(meta.requestBody);
    assert.equal(meta.requestBody.required, false);
  });
});

describe('@Response decorator', () => {
  class TestController {
    @Get('/responses')
    @Response(200, 'Success')
    @Response(400, 'Bad Request')
    @Response(401, 'Unauthorized')
    withResponses() {}
  }

  it('stores multiple responses with status codes and descriptions', () => {
    const meta = getOperationMetadata(TestController.prototype, 'withResponses');
    assert.ok(meta);
    assert.ok(meta.responses);

    const successResp = meta.responses?.get(200);
    assert.ok(successResp);
    assert.equal(successResp.statusCode, 200);
    assert.equal(successResp.description, 'Success');

    const badReqResp = meta.responses?.get(400);
    assert.ok(badReqResp);
    assert.equal(badReqResp.description, 'Bad Request');

    const unauthorizedResp = meta.responses?.get(401);
    assert.ok(unauthorizedResp);
    assert.equal(unauthorizedResp.description, 'Unauthorized');
  });
});

describe('Parameter Decorators', () => {
  class TestController {
    pathParam(@PathParam('id') _id: string) {}
    queryParam(@QueryParam('page') _page: number) {}
    headerParam(@HeaderParam('X-Request-Id') _reqId: string) {}
    bodyParam(@Body() _body: unknown) {}
  }

  it('@PathParam stores path parameter metadata', () => {
    const params = Reflect.getMetadata('pathParams', TestController.prototype, 'pathParam');
    assert.ok(params);
    assert.equal(params.length, 1);
    assert.equal(params[0].name, 'id');
    assert.equal(params[0].in, 'path');
  });

  it('@QueryParam stores query parameter metadata', () => {
    const params = Reflect.getMetadata('queryParams', TestController.prototype, 'queryParam');
    assert.ok(params);
    assert.equal(params.length, 1);
    assert.equal(params[0].name, 'page');
    assert.equal(params[0].in, 'query');
  });

  it('@HeaderParam stores header parameter metadata', () => {
    const params = Reflect.getMetadata('headerParams', TestController.prototype, 'headerParam');
    assert.ok(params);
    assert.equal(params.length, 1);
    assert.equal(params[0].name, 'X-Request-Id');
    assert.equal(params[0].in, 'header');
  });

  it('@Body stores body parameter metadata', () => {
    const params = Reflect.getMetadata('bodyParam', TestController.prototype, 'bodyParam');
    assert.ok(params);
    assert.equal(params.length, 1);
    assert.equal(params[0].index, 0);
  });
});

describe('Decorator composition', () => {
  class TestController {
    @Post('/composed')
    @Summary('Composed endpoint')
    @Description('This endpoint has multiple decorators')
    @Tags('composed', 'test')
    @Response(200, 'Success', { contentType: 'application/json' })
    @Response(500, 'Server Error')
    composedEndpoint() {}
  }

  it('allows multiple decorators on same method', () => {
    const routeMeta = getRouteMetadata(TestController.prototype, 'composedEndpoint');
    assert.ok(routeMeta);
    assert.equal(routeMeta.method, 'post');
    assert.equal(routeMeta.path, '/composed');

    const opMeta = getOperationMetadata(TestController.prototype, 'composedEndpoint');
    assert.ok(opMeta);
    assert.equal(opMeta.summary, 'Composed endpoint');
    assert.equal(opMeta.description, 'This endpoint has multiple decorators');
    assert.deepEqual(opMeta.tags, ['composed', 'test']);
    assert.ok(opMeta.responses);
    assert.equal(opMeta.responses.size, 2);
  });
});