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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const method = instance[methodName as keyof typeof instance] as any;
    const handler = method.bind(instance);

    routes.push({
      method: routeMeta.method,
      path: routeMeta.path,
      handler,
      operationMetadata: getOperationMetadata(proto, methodName),
    });
  }

  return routes;
}

export function registerController(app: Application, controller: object): void {
  const controllerClass = controller.constructor as new () => object;
  const routes = getControllerRoutesFromInstance(controller);

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

export function getRegisteredRoutes(controller: object): Array<{
  method: string;
  path: string;
  handler: (req: object, res: object, next?: () => void) => void;
}> {
  const controllerClass = controller.constructor as new () => object;
  const routes = getControllerRoutesFromInstance(controller);
  const ctrlMeta = getControllerMetadata(controllerClass);
  return routes.map(route => ({
    method: route.method,
    path: ctrlMeta ? `${ctrlMeta.prefix}${route.path}` : route.path,
    handler: route.handler,
  }));
}