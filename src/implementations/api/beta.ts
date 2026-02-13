import { computeParameter, RouteHandler, ControllerMeta } from '@ajs.local/api/beta';
import { registerHandler, RequestContext, unregisterHandler } from '../../server';
import { GetMetadata } from '@ajs/core/beta';

type UnknownRecord = Record<string, unknown>;

type ControllerConstructor = new () => UnknownRecord;

interface ControllerMetadata {
  computed_props: Record<string, unknown>;
}

const classCacheSymbol = Symbol();
const registeredRoutes = new Map<string, RouteHandler>();

interface RequestContextDev extends RequestContext {
  [classCacheSymbol]?: Map<object, UnknownRecord>;
}

function getControllerCache(context: RequestContextDev): Map<object, UnknownRecord> {
  if (!context[classCacheSymbol]) {
    context[classCacheSymbol] = new Map<object, UnknownRecord>();
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
  controllerClass: ControllerConstructor,
  context: RequestContextDev,
): Promise<UnknownRecord> {
  const controllerCache = getControllerCache(context);
  const cachedController = controllerCache.get(controllerClass.prototype);

  if (cachedController) {
    return cachedController;
  }

  const controllerInstance = new controllerClass();
  const controllerMetadata = GetMetadata(controllerClass, ControllerMeta) as ControllerMetadata;

  await applyComputedProperties(controllerInstance, controllerMetadata, context);

  controllerCache.set(controllerClass.prototype, controllerInstance);
  return controllerInstance;
}

interface RouteInfo {
  id: string;
  uri: string;
  method: string;
  mode: 'prefix' | 'postfix' | 'handler' | 'websocket';
  priority?: number;
  callbackName: string;
}

async function invokeHandler(handler: RouteHandler, context: RequestContextDev): Promise<unknown> {
  const controllerClass = handler.proto.constructor as ControllerConstructor;
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
