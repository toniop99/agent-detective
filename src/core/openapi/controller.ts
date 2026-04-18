import type { Application, Router } from 'express';
import type { ControllerMetadata, ControllerRoute } from './metadata.js';
import {
  getControllerMetadata,
  getRouteMetadata,
  getOperationMetadata,
  CONTROLLER_METADATA_KEY,
} from './metadata.js';

export function Controller(prefix: string, options?: { tags?: string[]; description?: string }) {
  return function <T extends new () => object>(target: T): void {
    const metadata: ControllerMetadata = {
      prefix,
      tags: options?.tags,
      description: options?.description,
    };
    Reflect.defineMetadata(CONTROLLER_METADATA_KEY, metadata, target);
  };
}

function getControllerRoutesFromInstance(instance: object): ControllerRoute[] {
  const controllerClass = instance.constructor as new () => object;
  const controllerMetadata = getControllerMetadata(controllerClass);
  if (!controllerMetadata) {
    return [];
  }

  const routes: ControllerRoute[] = [];
  const proto = Object.getPrototypeOf(instance);

  for (const methodName of Object.getOwnPropertyNames(proto)) {
    if (methodName === 'constructor') continue;

    const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
    if (!descriptor || typeof descriptor.value !== 'function') continue;

    const routeMeta = getRouteMetadata(proto, methodName);
    if (!routeMeta) continue;

    const handler = (instance[methodName as keyof typeof instance] as Function).bind(instance);

    routes.push({
      method: routeMeta.method,
      path: routeMeta.path,
      handler: handler as Function,
      operationMetadata: getOperationMetadata(proto, methodName),
    });
  }

  return routes;
}

export function registerController(app: Application, controllerClassOrInstance: object | (new () => object)): void {
  let controllerInstance: object;
  let controllerClass: new () => object;

  if (typeof controllerClassOrInstance === 'function') {
    controllerClass = controllerClassOrInstance as new () => object;
    controllerInstance = new controllerClass();
  } else {
    controllerInstance = controllerClassOrInstance;
    controllerClass = controllerInstance.constructor as new () => object;
  }

  const routes = getControllerRoutesFromInstance(controllerInstance);

  for (const route of routes) {
    const ctrlMeta = getControllerMetadata(controllerClass);
    const fullPath = ctrlMeta ? `${ctrlMeta.prefix}${route.path}` : route.path;
    const router = app as unknown as Router;
    router[route.method](fullPath, route.handler as Parameters<Router['get']>[1]);
  }
}

export function registerControllers(app: Application, controllers: object[]): void {
  for (const ctrl of controllers) {
    registerController(app, ctrl);
  }
}

export function getRegisteredRoutes(controllerOrClass: object | (new () => object)): Array<{
  method: string;
  path: string;
  handler: Function;
  operationMetadata?: import('./metadata.js').OperationMetadata;
}> {
  let controllerInstance: object;
  let controllerClass: new () => object;

  if (typeof controllerOrClass === 'function') {
    controllerClass = controllerOrClass as new () => object;
    controllerInstance = new controllerClass();
  } else {
    controllerInstance = controllerOrClass;
    controllerClass = controllerInstance.constructor as new () => object;
  }

  const routes = getControllerRoutesFromInstance(controllerInstance);
  const ctrlMeta = getControllerMetadata(controllerClass);
  return routes.map(route => ({
    method: route.method,
    path: ctrlMeta ? `${ctrlMeta.prefix}${route.path}` : route.path,
    handler: route.handler,
    operationMetadata: route.operationMetadata,
  }));
}