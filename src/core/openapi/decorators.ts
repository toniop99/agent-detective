import 'reflect-metadata';
import type { OperationMetadata, ResponseMetadata, RequestBodyMetadata } from './metadata.js';
import { setRouteMetadata, setOperationMetadata, getOperationMetadata } from './metadata.js';

type MethodDecorator = (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor;

function createMethodDecorator(method: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'use') {
  return function(path: string): MethodDecorator {
    return function(target, propertyKey, descriptor) {
      setRouteMetadata(target, propertyKey as string, { method, path });
      return descriptor;
    };
  };
}

export const Get = createMethodDecorator('get');
export const Post = createMethodDecorator('post');
export const Put = createMethodDecorator('put');
export const Delete = createMethodDecorator('delete');
export const Patch = createMethodDecorator('patch');
export const Use = createMethodDecorator('use');

export function Summary(value: string): MethodDecorator {
  return function(target, propertyKey, descriptor) {
    setOperationMetadata(target, propertyKey as string, { summary: value });
    return descriptor;
  };
}

export function Description(value: string): MethodDecorator {
  return function(target, propertyKey, descriptor) {
    const existing = getOperationMetadata(target, propertyKey as string) || {} as OperationMetadata;
    setOperationMetadata(target, propertyKey as string, { ...existing, description: value });
    return descriptor;
  };
}

export function Tags(...tagList: string[]): MethodDecorator {
  return function(target, propertyKey, descriptor) {
    const existing = getOperationMetadata(target, propertyKey as string) || {} as OperationMetadata;
    setOperationMetadata(target, propertyKey as string, { ...existing, tags: tagList });
    return descriptor;
  };
}

export function OperationId(value: string): MethodDecorator {
  return function(target, propertyKey, descriptor) {
    const existing = getOperationMetadata(target, propertyKey as string) || {} as OperationMetadata;
    setOperationMetadata(target, propertyKey as string, { ...existing, operationId: value });
    return descriptor;
  };
}

export function Deprecated(): MethodDecorator {
  return function(target, propertyKey, descriptor) {
    const existing = getOperationMetadata(target, propertyKey as string) || {} as OperationMetadata;
    setOperationMetadata(target, propertyKey as string, { ...existing, deprecated: true });
    return descriptor;
  };
}

export function Security(scheme: string): MethodDecorator {
  return function(target, propertyKey, descriptor) {
    const existing = getOperationMetadata(target, propertyKey as string) || {} as OperationMetadata;
    setOperationMetadata(target, propertyKey as string, { ...existing, security: [scheme] });
    return descriptor;
  };
}

export function RequestBody(options?: {
  description?: string;
  required?: boolean;
  contentType?: string;
  example?: unknown;
  schema?: Record<string, unknown>;
}): MethodDecorator {
  return function(target, propertyKey, descriptor) {
    const existing = getOperationMetadata(target, propertyKey as string) || {} as OperationMetadata;
    const requestBody: RequestBodyMetadata = {
      description: options?.description,
      required: options?.required ?? true,
      contentType: options?.contentType ?? 'application/json',
      example: options?.example,
      schema: options?.schema,
    };
    setOperationMetadata(target, propertyKey as string, { ...existing, requestBody });
    return descriptor;
  };
}

export function Response(
  statusCode: number,
  description: string,
  options?: {
    contentType?: string;
    example?: unknown;
    schema?: Record<string, unknown>;
  }
): MethodDecorator {
  return function(target, propertyKey, descriptor) {
    const existing = getOperationMetadata(target, propertyKey as string) || {} as OperationMetadata;
    const responses = existing.responses ? new Map(existing.responses) : new Map<number, ResponseMetadata>();
    responses.set(statusCode, {
      statusCode,
      description,
      contentType: options?.contentType,
      example: options?.example,
      schema: options?.schema,
    });
    setOperationMetadata(target, propertyKey as string, { ...existing, responses });
    return descriptor;
  };
}

export function PathParam(name: string): ParameterDecorator {
  return function(target, propertyKey) {
    const key = propertyKey as string;
    const params = (Reflect.getMetadata('pathParams', target, key) as Array<{ name: string; in: string }>) || [];
    params.push({ name, in: 'path' });
    Reflect.defineMetadata('pathParams', params, target, key);
  };
}

export function QueryParam(name: string): ParameterDecorator {
  return function(target, propertyKey) {
    const key = propertyKey as string;
    const params = (Reflect.getMetadata('queryParams', target, key) as Array<{ name: string; in: string }>) || [];
    params.push({ name, in: 'query' });
    Reflect.defineMetadata('queryParams', params, target, key);
  };
}

export function HeaderParam(name: string): ParameterDecorator {
  return function(target, propertyKey) {
    const key = propertyKey as string;
    const params = (Reflect.getMetadata('headerParams', target, key) as Array<{ name: string; in: string }>) || [];
    params.push({ name, in: 'header' });
    Reflect.defineMetadata('headerParams', params, target, key);
  };
}

export function Body(): ParameterDecorator {
  return function(target, propertyKey, parameterIndex) {
    const key = propertyKey as string;
    const params = (Reflect.getMetadata('bodyParam', target, key) as { index: number }[]) || [];
    params.push({ index: parameterIndex });
    Reflect.defineMetadata('bodyParam', params, target, key);
  };
}