import { computeParameter, RouteHandler, ControllerMeta, ComputedParameter } from '@ajs.local/api/beta';
import { listenServers } from '../../index';
import { registerHandler, RequestContext, unregisterHandler } from '../../server';
import { GetMetadata } from '@ajs/core/beta';
import { Class } from '@ajs/core/beta/decorators';

type UnknownRecord = Record<PropertyKey, unknown>;

type ControllerClass = Class<unknown> & {
  location: string;
};

interface ControllerMetadata {
  computed_props: Record<PropertyKey, ComputedParameter>;
}

const classCacheSymbol = Symbol();
const registeredRoutes = new Map<string, RouteHandler>();

interface RequestContextDev extends RequestContext {
  [classCacheSymbol]?: Map<object, unknown>;
}

function getControllerCache(context: RequestContextDev): Map<object, unknown> {
  if (!context[classCacheSymbol]) {
    context[classCacheSymbol] = new Map<object, unknown>();
  }

  return context[classCacheSymbol];
}

async function applyComputedProperties(
  controllerInstance: UnknownRecord,
  controllerMetadata: ControllerMetadata,
  context: RequestContextDev,
): Promise<void> {
  await Promise.all(
    Object.entries(controllerMetadata.computed_props).map(async ([propertyKey, parameter]) => {
      const computedValue = await computeParameter(context, parameter, controllerInstance);
      controllerInstance[propertyKey] = computedValue;
    }),
  );
}

export async function GetControllerInstance(
  controllerClass: Class<unknown>,
  context: RequestContext,
): Promise<unknown> {
  const controllerCache = getControllerCache(context as RequestContextDev);
  const cacheKey = controllerClass.prototype;
  const cachedController = controllerCache.get(cacheKey) as UnknownRecord | undefined;

  if (cachedController) {
    return cachedController;
  }

  const typedControllerClass = controllerClass as ControllerClass;
  const controllerInstance = new typedControllerClass() as UnknownRecord;
  const controllerMetadata = GetMetadata(typedControllerClass, ControllerMeta) as ControllerMetadata;

  await applyComputedProperties(controllerInstance, controllerMetadata, context as RequestContextDev);

  controllerCache.set(cacheKey, controllerInstance);
  return controllerInstance;
}

export async function Listen(): Promise<void> {
  await listenServers();
}

interface RouteInfo {
  id: string;
  uri: string;
  method: string;
  mode: 'prefix' | 'postfix' | 'handler' | 'monitor' | 'websocket';
  priority?: number;
  callbackName: string;
}

async function invokeHandler(handler: RouteHandler, context: RequestContextDev): Promise<unknown> {
  const controllerClass = handler.proto.constructor as ControllerClass;
  const controllerInstance = await GetControllerInstance(controllerClass, context);
  const resolvedParameters = await Promise.all(
    handler.parameters.map((parameter) => computeParameter(context, parameter, controllerInstance)),
  );
  return handler.callback.apply(controllerInstance, resolvedParameters);
}

export const routesProxy = {
  register: (id: string, handler: RouteHandler): void => {
    registeredRoutes.set(id, handler);
    registerHandler(
      'dev/' + id,
      handler.mode,
      handler.method,
      handler.location,
      async (context: RequestContextDev) => invokeHandler(handler, context),
      handler.priority,
    );
  },
  unregister: (id: string): void => {
    registeredRoutes.delete(id);
    unregisterHandler('dev/' + id);
  },
  getRoutes: (): RouteInfo[] => {
    const routes: RouteInfo[] = [];

    registeredRoutes.forEach((handler, id) => {
      routes.push({
        id,
        uri: handler.location,
        method: handler.method,
        mode: handler.mode,
        priority: handler.priority,
        callbackName: handler.callback.name || 'anonymous',
      });
    });

    return routes;
  },
};
