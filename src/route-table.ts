import { HandlerPriority } from "@antelopejs/interface-api";

import type { RouteCallback } from "./request-context";
import {
  compileDynamicRoute,
  type HandlerResult,
  type IndexedRouteCallback,
  RouteLevel,
} from "./route-level";
import { findHandlers, type HandlerSearch, isSettled } from "./route-search";

export type { HandlerResult } from "./route-level";

const HANDLER_MODES = [
  "handler",
  "prefix",
  "postfix",
  "monitor",
  "websocket",
] as const;

export type HandlerMode = (typeof HANDLER_MODES)[number];

type MethodTable = Map<string, RouteLevel>;

const roots: Record<HandlerMode, MethodTable> = {
  handler: new Map(),
  prefix: new Map(),
  postfix: new Map(),
  monitor: new Map(),
  websocket: new Map(),
};

const handlerCounts: Record<HandlerMode, number> = {
  handler: 0,
  prefix: 0,
  postfix: 0,
  monitor: 0,
  websocket: 0,
};

type HandlerLookupResult =
  | HandlerResult
  | RouteCallback
  | HandlerResult[]
  | undefined;
type ExactHandlerIndex = Record<string, Map<string, RouteCallback>>;

const exactHandlerIndexes = new WeakMap<MethodTable, ExactHandlerIndex>([
  [roots.handler, {}],
  [roots.websocket, {}],
]);

function updateExactHandler(
  source: MethodTable,
  method: string,
  level: RouteLevel,
  removedExactPath?: string,
) {
  const index = exactHandlerIndexes.get(source);
  const exactPath = level.handlers[0]?.exactPath ?? removedExactPath;
  if (!index || !exactPath) {
    return;
  }

  const methodIndex = index[method];
  if (level.handlers.length !== 1) {
    methodIndex?.delete(exactPath);
    if (methodIndex?.size === 0) {
      delete index[method];
    }
    return;
  }

  const handler = level.handlers[0];
  if (!methodIndex) {
    index[method] = new Map();
  }
  index[method].set(exactPath, handler.callback);
}

function findForMethod(
  source: MethodTable,
  method: string,
  search: HandlerSearch,
): HandlerResult | RouteCallback | undefined {
  const level = source.get(method);
  if (!level) {
    return undefined;
  }
  if (!search.multi && search.exactPath) {
    const exactHandler = exactHandlerIndexes
      .get(source)
      ?.[method]?.get(search.exactPath);
    if (exactHandler) {
      return exactHandler;
    }
  }
  search.parameters = {};
  search.parameterCount = 0;
  findHandlers(search, 0, level);
  return isSettled(search) ? search.result[0] : undefined;
}

function getHandler(
  method: string,
  path: string[],
  source: MethodTable,
  multi = false,
  exactPath?: string,
): HandlerLookupResult {
  const search: HandlerSearch = {
    path,
    result: [],
    parameters: {},
    parameterCount: 0,
    multi,
    exactPath,
  };
  const handler =
    findForMethod(source, method, search) ??
    findForMethod(source, "any", search);
  if (handler) {
    return handler;
  }
  return multi ? search.result : undefined;
}

function removeHandlerFromLevel(
  id: string,
  level: RouteLevel,
  source: MethodTable,
  method: string,
): number {
  const handlerLength = level.handlers.length;
  const removedExactPath = level.handlers.find(
    (handler) => handler.id === id,
  )?.exactPath;
  level.handlers = level.handlers.filter((handler) => handler.id !== id);
  const removedCount = handlerLength - level.handlers.length;

  if (removedCount > 0) {
    updateExactHandler(source, method, level, removedExactPath);
    return removedCount;
  }

  for (const child of Object.values(level.staticRoutes)) {
    const staticRemovedCount = removeHandlerFromLevel(
      id,
      child,
      source,
      method,
    );
    if (staticRemovedCount > 0) {
      return staticRemovedCount;
    }
  }

  for (const route of level.dynamicRouteList) {
    const dynamicRemovedCount = removeHandlerFromLevel(
      id,
      route.sub,
      source,
      method,
    );
    if (dynamicRemovedCount > 0) {
      return dynamicRemovedCount;
    }
  }

  for (const catchAll of level.catchAllRoutes) {
    const catchAllRemovedCount = removeHandlerFromLevel(
      id,
      catchAll.level,
      source,
      method,
    );
    if (catchAllRemovedCount > 0) {
      return catchAllRemovedCount;
    }
  }

  return 0;
}

function removeHandler(id: string, source: MethodTable): number {
  for (const [method, level] of source) {
    const removedCount = removeHandlerFromLevel(id, level, source, method);
    if (removedCount > 0) {
      return removedCount;
    }
  }
  return 0;
}

/** Where a handler is registered: its mode, HTTP method (`any` when absent), location and priority. */
export interface RouteDefinition {
  mode: HandlerMode;
  method?: string;
  location: string;
  priority?: HandlerPriority;
}

export function registerHandler(
  id: string,
  route: RouteDefinition,
  handler: RouteCallback,
) {
  const { mode, method, location, priority = HandlerPriority.NORMAL } = route;
  const parts = location.split("/").filter((part) => part);
  const source = roots[mode];
  const routeMethod = method?.toLowerCase() || "any";
  let level = source.get(routeMethod);
  if (!level) {
    level = new RouteLevel();
    source.set(routeMethod, level);
  }
  for (let i = 0; i < parts.length; ++i) {
    const part = parts[i];

    if (part.startsWith("::")) {
      const paramName = part.slice(2);
      if (!paramName) {
        throw new Error("Catch-all parameter must have a name");
      }

      const suffix = parts.slice(i + 1);
      for (const suffixPart of suffix) {
        if (suffixPart.indexOf(":") >= 0) {
          throw new Error("Dynamic segments after catch-all are not supported");
        }
      }

      const suffixKey = suffix.join("/");
      let catchAll = level.catchAllRoutes.find(
        (route) =>
          route.paramName === paramName && route.suffix.join("/") === suffixKey,
      );

      if (!catchAll) {
        catchAll = { paramName, suffix, level: new RouteLevel() };
        level.catchAllRoutes.push(catchAll);
      }

      level = catchAll.level;
      break;
    }

    if (part.indexOf(":") >= 0) {
      if (!(part in level.dynamicRoutes)) {
        const route = compileDynamicRoute(part);
        level.dynamicRoutes[part] = route;
        level.dynamicRouteList.push(route);
      }
      level = level.dynamicRoutes[part].sub;
    } else {
      if (!(part in level.staticRoutes)) {
        level.staticRoutes[part] = new RouteLevel();
      }
      level = level.staticRoutes[part];
    }
  }
  const identifiableHandler: IndexedRouteCallback = {
    id,
    callback: handler,
    priority,
  };
  if (parts.every((part) => !part.includes(":"))) {
    identifiableHandler.exactPath = `/${parts.join("/")}`;
  }
  level.handlers.push(identifiableHandler);
  updateExactHandler(source, routeMethod, level);
  handlerCounts[mode] += 1;
}

export function unregisterHandler(id: string) {
  for (const mode of HANDLER_MODES) {
    const removedCount = removeHandler(id, roots[mode]);
    if (removedCount > 0) {
      handlerCounts[mode] -= removedCount;
      return;
    }
  }
}

export function getMultiHandlers(
  method: string,
  path: string[],
  mode: HandlerMode,
): HandlerResult[] {
  const handlers = getHandler(method, path, roots[mode], true);
  return Array.isArray(handlers) ? handlers : [];
}

export function hasHandlers(mode: HandlerMode): boolean {
  return handlerCounts[mode] !== 0;
}

export function findRouteHandler(
  mode: "handler" | "websocket",
  method: string,
  path: string[],
  exactPath: string,
): HandlerLookupResult {
  return getHandler(method, path, roots[mode], false, exactPath);
}
