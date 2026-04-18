import 'reflect-metadata';

export const ROUTE_METADATA_KEY = Symbol.for('agent-detective:route');
export const OPERATION_METADATA_KEY = Symbol.for('agent-detective:operation');
export const CONTROLLER_METADATA_KEY = Symbol.for('agent-detective:controller');
export const PARAMETER_METADATA_KEY = Symbol.for('agent-detective:parameter');

export interface RouteMetadata {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'use';
  path: string;
}

export interface ResponseMetadata {
  statusCode: number;
  description: string;
  contentType?: string;
  example?: unknown;
  schema?: Record<string, unknown>;
}

export interface OperationMetadata {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
  security?: string[];
  responses?: Map<number, ResponseMetadata>;
  requestBody?: RequestBodyMetadata;
}

export interface RequestBodyMetadata {
  description?: string;
  required?: boolean;
  contentType?: string;
  example?: unknown;
  schema?: Record<string, unknown>;
}

export interface ParameterMetadata {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

export interface ControllerMetadata {
  prefix: string;
  tags?: string[];
  description?: string;
}

export function setRouteMetadata(
  target: object,
  methodName: string,
  metadata: RouteMetadata
): void {
  Reflect.defineMetadata(ROUTE_METADATA_KEY, metadata, target, methodName);
}

export function getRouteMetadata(
  target: object,
  methodName: string
): RouteMetadata | undefined {
  return Reflect.getMetadata(ROUTE_METADATA_KEY, target, methodName);
}

export function setOperationMetadata(
  target: object,
  methodName: string,
  metadata: Partial<OperationMetadata>
): void {
  const existing = getOperationMetadata(target, methodName) || ({} as OperationMetadata);
  const merged = { ...existing, ...metadata };
  Reflect.defineMetadata(OPERATION_METADATA_KEY, merged, target, methodName);
}

export function getOperationMetadata(
  target: object,
  methodName: string
): OperationMetadata | undefined {
  return Reflect.getMetadata(OPERATION_METADATA_KEY, target, methodName);
}

export function setControllerMetadata(
  target: new () => object,
  metadata: ControllerMetadata
): void {
  Reflect.defineMetadata(CONTROLLER_METADATA_KEY, metadata, target);
}

export function getControllerMetadata(
  target: new () => object
): ControllerMetadata | undefined {
  return Reflect.getMetadata(CONTROLLER_METADATA_KEY, target);
}

export interface ControllerRoute {
  method: RouteMetadata['method'];
  path: string;
  handler: (req: object, res: object, next?: () => void) => void;
  operationMetadata?: OperationMetadata;
}

export function getControllerRoutes(
  controllerClass: new () => object
): ControllerRoute[] {
  const controllerMetadata = getControllerMetadata(controllerClass);
  if (!controllerMetadata) {
    return [];
  }

  const routes: ControllerRoute[] = [];
  const prototype = controllerClass.prototype;

  for (const methodName of Object.getOwnPropertyNames(prototype)) {
    if (methodName === 'constructor') continue;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
    if (!descriptor || typeof descriptor.value !== 'function') continue;

    const routeMetadata = getRouteMetadata(prototype, methodName);
    if (!routeMetadata) continue;

    const operationMetadata = getOperationMetadata(prototype, methodName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const method = prototype[methodName] as any;
    const handler = method.bind(prototype);

    routes.push({
      method: routeMetadata.method,
      path: routeMetadata.path,
      handler,
      operationMetadata,
    });
  }

  return routes;
}