import 'reflect-metadata';

export {
  /**
   * HTTP Method Decorators
   * 
   * @example
   * ```typescript
   * @Controller('/api')
   * class MyController {
   *   @Get('/items')
   *   listItems() { ... }
   *   
   *   @Post('/items')
   *   createItem() { ... }
   * }
   * ```
   */
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Use,
  /**
   * OpenAPI Documentation Decorators
   * 
   * @example
   * ```typescript
   * @Get('/items')
   * @Summary('List all items')
   * @Description('Returns a paginated list of items')
   * @Tags('items', 'list')
   * @Response(200, 'Success')
   * @Response(401, 'Unauthorized')
   * listItems() { ... }
   * ```
   */
  Summary,
  Description,
  Tags,
  OperationId,
  Deprecated,
  Security,
  /**
   * Request/Response Documentation
   * 
   * @example
   * ```typescript
   * @Post('/items')
   * @RequestBody({ description: 'Item data', required: true })
   * @Response(201, 'Created')
   * @Response(400, 'Bad Request')
   * createItem() { ... }
   * ```
   */
  RequestBody,
  Response,
  /**
   * Parameter Decorators
   * 
   * @example
   * ```typescript
   * @Get('/items/:id')
   * getItem(@PathParam('id') id: string, @QueryParam('include') include: string) { ... }
   * ```
   */
  PathParam,
  QueryParam,
  HeaderParam,
  Body,
} from './decorators.js';

/**
 * Controller decorator and registration utilities.
 * 
 * @example
 * ```typescript
 * @Controller('/plugins/my-plugin', { tags: ['my-plugin'], description: 'My plugin' })
 * class MyPluginController {
   *   @Get('/repos')
   *   @Summary('List repositories')
   *   listRepos() { ... }
   * }
   * 
   * // In your plugin's register function:
   * registerController(app, MyPluginController);
   * ```
 */
export {
  Controller,
  registerController,
  registerControllers,
  getRegisteredRoutes,
} from './controller.js';

/**
 * OpenAPI specification generation utilities.
 * 
 * @example
 * ```typescript
 * // Generate spec from registered controllers
 * const spec = generateSpecFromControllers([MyController]);
 * 
 * // Generate spec from captured routes
 * const routes = routeRegistry.getRoutes();
 * const spec = generateSpecFromRoutes(routes);
 * ```
 */
export {
  generateSpecFromControllers,
  generateSpecFromRoutes,
  type OpenAPISpec,
  type PathOperation,
  type RequestBodySpec,
  type ResponseSpec,
  type ParameterSpec,
  type Tag,
  type TagGroup,
} from './spec-generator.js';

/**
 * Constants for tag naming and Scalar configuration.
 */
export {
  CORE_PLUGIN_TAG,
  RESERVED_TAGS,
  SCALAR_TAG_GROUPS,
  createTagDescription,
} from './constants.js';

/**
 * Metadata types and storage utilities for decorators.
 * These are primarily for internal use but may be useful for advanced scenarios.
 */
export {
  ROUTE_METADATA_KEY,
  OPERATION_METADATA_KEY,
  CONTROLLER_METADATA_KEY,
  PARAMETER_METADATA_KEY,
  type RouteMetadata,
  type OperationMetadata,
  type ResponseMetadata,
  type RequestBodyMetadata,
  type ParameterMetadata,
  type ControllerMetadata,
  type ControllerRoute,
  setRouteMetadata,
  getRouteMetadata,
  setOperationMetadata,
  getOperationMetadata,
  setControllerMetadata,
  getControllerMetadata,
  getControllerRoutes,
} from './metadata.js';