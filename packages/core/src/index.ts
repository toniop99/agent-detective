import 'reflect-metadata';

export {
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Use,
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
} from './decorators.js';

export {
  Controller,
  registerController,
  registerControllers,
  getRegisteredRoutes,
} from './controller.js';

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

export {
  CORE_PLUGIN_TAG,
  RESERVED_TAGS,
  SCALAR_TAG_GROUPS,
  createTagDescription,
} from './constants.js';

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
