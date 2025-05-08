import { computeParameter, RouteHandler, ControllerMeta } from '@ajs.local/api/beta';
import { registerHandler, RequestContext, unregisterHandler } from '../../server';
import { GetMetadata } from '@ajs/core/beta';

const classCacheSymbol = Symbol();
const registeredRoutes = new Map<string, RouteHandler>();

interface RequestContextDev extends RequestContext {
  [classCacheSymbol]?: Map<any, any>;
}

export async function GetControllerInstance(cl: any, context: RequestContextDev) {
  if (!(classCacheSymbol in context)) {
    context[classCacheSymbol] = new Map();
  }
  if (context[classCacheSymbol]!.has(cl.prototype)) {
    return context[classCacheSymbol]!.get(cl.prototype)!;
  }

  const obj = new cl();
  const meta = GetMetadata(cl, ControllerMeta);

  await Promise.all(
    Object.entries(meta.computed_props).map(async ([key, param]) => {
      const val = await computeParameter(context, param, obj);
      obj[key] = val;
    }),
  );

  context[classCacheSymbol]!.set(cl.prototype, obj);
  return obj;
}

interface RouteInfo {
  id: string;
  uri: string;
  method: string;
  mode: 'prefix' | 'postfix' | 'handler' | 'websocket';
  priority?: number;
  callbackName: string;
}

export const routesProxy = {
  register: (id: string, handler: RouteHandler) => {
    registeredRoutes.set(id, handler);
    registerHandler(
      'dev/' + id,
      handler.mode,
      handler.method,
      handler.location,
      async (context: RequestContextDev) => {
        const thisObj = await GetControllerInstance(handler.proto.constructor, context);
        const params = await Promise.all(handler.parameters.map((param) => computeParameter(context, param, thisObj)));
        return handler.callback.apply(thisObj, params);
      },
      handler.priority,
    );
  },
  unregister: (id: string) => {
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
