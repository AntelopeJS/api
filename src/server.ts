import { type IncomingMessage, ServerResponse } from "node:http";
import type stream from "node:stream";
import { HandlerPriority, HTTPResult } from "@antelopejs/interface-api";
import { type WebSocket, WebSocketServer } from "ws";

export type RouteCallback = (context: RequestContext) => unknown;
export interface IdentifiableRouteCallback {
  id: string;
  callback: RouteCallback;
  priority: HandlerPriority;
}

type HandlerMode = "prefix" | "postfix" | "handler" | "monitor" | "websocket";
type MiddlewareMode = "prefix" | "postfix";

interface IndexedRouteCallback extends IdentifiableRouteCallback {
  exactPath?: string;
}

export interface RequestContext {
  rawRequest: IncomingMessage;
  rawResponse: ServerResponse;
  url: URL;
  routeParameters: Record<string, string>;
  response: HTTPResult;
  error?: unknown;
  connection?: unknown /* WebsocketConnection */;
}

interface DynamicRoute {
  match: RegExp;
  requiredPrefix: string;
  requiredSuffix: string;
  parameterName?: string;
  parameterNames: string[];
  sub: RouteLevel;
}

interface CatchAllRoute {
  paramName: string;
  suffix: string[];
  level: RouteLevel;
}

class RouteLevel {
  handlers: IndexedRouteCallback[] = [];
  staticRoutes: Record<string, RouteLevel> = {};
  dynamicRoutes: Record<string, DynamicRoute> = {};
  dynamicRouteList: DynamicRoute[] = [];
  catchAllRoutes: CatchAllRoute[] = [];
}

const roots: Record<HandlerMode, Record<string, RouteLevel>> = {
  handler: {},
  prefix: {},
  postfix: {},
  monitor: {},
  websocket: {},
};

const handlerCounts: Record<HandlerMode, number> = {
  handler: 0,
  prefix: 0,
  postfix: 0,
  monitor: 0,
  websocket: 0,
};

interface HandlerResult {
  handler: RouteCallback;
  parameters: Record<string, string>;
  priority: HandlerPriority;
}

type HandlerLookupResult =
  | HandlerResult
  | RouteCallback
  | HandlerResult[]
  | undefined;
type Awaitable<T> = T | PromiseLike<T>;
type ThenCallback = (
  onfulfilled: (value: unknown) => unknown,
  onrejected: (reason: unknown) => unknown,
) => unknown;
type ExactHandlerIndex = Record<string, Map<string, RouteCallback>>;

interface PromiseLikeValue {
  then?: unknown;
}

const exactHandlerIndexes = new WeakMap<
  Record<string, RouteLevel>,
  ExactHandlerIndex
>([
  [roots.handler, {}],
  [roots.websocket, {}],
]);

function updateExactHandler(
  source: Record<string, RouteLevel>,
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

function hasParameter(parameters: Record<string, string>, name: string) {
  return Object.getOwnPropertyDescriptor(parameters, name) !== undefined;
}

function findHandlers(
  path: string[],
  depth: number,
  level: RouteLevel,
  result: Array<HandlerResult>,
  parameters: Record<string, string>,
  multi = false,
  parameterCount = 0,
) {
  if (multi) {
    for (const handler of level.handlers) {
      result.push({
        handler: handler.callback,
        parameters: { ...parameters },
        priority: handler.priority,
      });
    }
  }
  if (depth >= path.length) {
    if (!multi && level.handlers.length > 0) {
      result.push({
        handler: level.handlers[0].callback,
        parameters,
        priority: level.handlers[0].priority,
      });
    }
    return;
  }

  const part = path[depth];

  if (part in level.staticRoutes) {
    findHandlers(
      path,
      depth + 1,
      level.staticRoutes[part],
      result,
      parameters,
      multi,
      parameterCount,
    );
    if (result.length > 0 && !multi) {
      return;
    }
  }

  for (const route of level.dynamicRouteList) {
    if (
      (route.requiredPrefix && !part.startsWith(route.requiredPrefix)) ||
      (route.requiredSuffix && !part.endsWith(route.requiredSuffix))
    ) {
      continue;
    }
    const match = route.match.exec(part);
    if (!match) {
      continue;
    }
    if (route.parameterName !== undefined) {
      const parameterName = route.parameterName;
      const previousValue = parameters[parameterName];
      const existingParameter =
        parameterCount > 0 && hasParameter(parameters, parameterName);
      parameters[parameterName] = match[1];
      findHandlers(
        path,
        depth + 1,
        route.sub,
        result,
        parameters,
        multi,
        parameterCount + 1,
      );
      if (result.length > 0 && !multi) {
        return;
      }
      if (existingParameter) {
        parameters[parameterName] = previousValue;
      } else {
        delete parameters[parameterName];
      }
      continue;
    }
    const previousValues = route.parameterNames.map((name) => parameters[name]);
    const existingParameters = route.parameterNames.map((name) =>
      hasParameter(parameters, name),
    );
    for (let index = 0; index < route.parameterNames.length; ++index) {
      parameters[route.parameterNames[index]] = match[index + 1];
    }
    findHandlers(
      path,
      depth + 1,
      route.sub,
      result,
      parameters,
      multi,
      parameterCount + route.parameterNames.length,
    );
    if (result.length > 0 && !multi) {
      return;
    }
    for (let index = 0; index < route.parameterNames.length; ++index) {
      const name = route.parameterNames[index];
      if (existingParameters[index]) {
        parameters[name] = previousValues[index];
      } else {
        delete parameters[name];
      }
    }
  }

  // Catch-all routes are evaluated last (after static and dynamic routes).
  for (const catchAll of level.catchAllRoutes) {
    const remaining = path.length - depth;
    const suffixLen = catchAll.suffix.length;

    // Need at least one segment captured by ::paramName.
    if (remaining < 1 + suffixLen) {
      continue;
    }

    if (suffixLen > 0) {
      const suffixStart = path.length - suffixLen;
      let matchesSuffix = true;
      for (let i = 0; i < suffixLen; ++i) {
        if (path[suffixStart + i] !== catchAll.suffix[i]) {
          matchesSuffix = false;
          break;
        }
      }
      if (!matchesSuffix) {
        continue;
      }
    }

    const captured = path.slice(depth, path.length - suffixLen);
    if (captured.length < 1) {
      continue;
    }

    const existingParameter = hasParameter(parameters, catchAll.paramName);
    const previousValue = parameters[catchAll.paramName];
    parameters[catchAll.paramName] = captured.join("/");
    findHandlers(
      path,
      path.length,
      catchAll.level,
      result,
      parameters,
      multi,
      parameterCount + 1,
    );
    if (result.length > 0 && !multi) {
      return;
    }
    if (existingParameter) {
      parameters[catchAll.paramName] = previousValue;
    } else {
      delete parameters[catchAll.paramName];
    }
  }
}

function getHandler(
  method: string,
  path: string[],
  source: Record<string, RouteLevel>,
  multi = false,
  exactPath?: string,
): HandlerLookupResult {
  let result: Array<HandlerResult> | undefined;
  if (method in source) {
    if (!multi && exactPath) {
      const exactHandler = exactHandlerIndexes
        .get(source)
        ?.[method]?.get(exactPath);
      if (exactHandler) {
        return exactHandler;
      }
    }
    result = [];
    findHandlers(path, 0, source[method], result, {}, multi);
    if (result.length > 0 && !multi) {
      return result[0];
    }
  }
  if ("any" in source) {
    if (!multi && exactPath) {
      const exactHandler = exactHandlerIndexes.get(source)?.any?.get(exactPath);
      if (exactHandler) {
        return exactHandler;
      }
    }
    result ??= [];
    findHandlers(path, 0, source.any, result, {}, multi);
    if (result.length > 0 && !multi) {
      return result[0];
    }
  }
  return multi ? (result ?? []) : undefined;
}

function removeHandlerFromLevel(
  id: string,
  level: RouteLevel,
  source: Record<string, RouteLevel>,
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

function removeHandler(id: string, source: Record<string, RouteLevel>): number {
  for (const [method, level] of Object.entries(source)) {
    const removedCount = removeHandlerFromLevel(id, level, source, method);
    if (removedCount > 0) {
      return removedCount;
    }
  }
  return 0;
}

const special = {
  $: true,
  "-": true,
  _: true,
  ".": true,
  "+": true,
  "!": true,
  " ": true,
  "*": true,
  "'": true,
  "(": true,
  ")": true,
  ",": true,
};

function compileDynamicRoute(part: string): DynamicRoute {
  const mapping = [];
  const pattern = ["^"];
  let word: string[] | undefined;
  for (const char of part) {
    if (char in special) {
      if (word) {
        mapping.push(word.join(""));
        pattern.push(`([^\\${char}]*)`);
        word = undefined;
      }
      pattern.push(`\\${char}`);
    } else if (char === ":") {
      if (word) {
        throw new Error("Invalid URL parameter");
      }
      word = [];
    } else if (char.match(/[a-zA-Z0-9]/)) {
      if (word) {
        word.push(char);
      } else {
        pattern.push(char);
      }
    } else {
      throw new Error("Invalid character in URL");
    }
  }
  if (word) {
    mapping.push(word.join(""));
    pattern.push(`(.*)`);
  }
  pattern.push("$");
  const firstParameter = part.indexOf(":");
  const lastParameter = part.lastIndexOf(":");
  let suffixStart = lastParameter + 1;
  while (suffixStart < part.length && /[a-zA-Z0-9]/.test(part[suffixStart])) {
    suffixStart += 1;
  }
  return {
    match: new RegExp(pattern.join("")),
    requiredPrefix: part.slice(0, firstParameter),
    requiredSuffix: part.slice(suffixStart),
    parameterName: mapping.length === 1 ? mapping[0] : undefined,
    parameterNames: mapping,
    sub: new RouteLevel(),
  };
}

export function registerHandler(
  id: string,
  mode: HandlerMode,
  method: string | undefined,
  location: string,
  handler: RouteCallback,
  priority = HandlerPriority.NORMAL,
) {
  const parts = location.split("/").filter((part) => part);
  const source = roots[mode];
  const routeMethod = method?.toLowerCase() || "any";
  let level = source[routeMethod];
  if (!level) {
    level = new RouteLevel();
    source[routeMethod] = level;
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
  for (const [mode, source] of Object.entries(roots)) {
    const removedCount = removeHandler(id, source);
    if (removedCount > 0) {
      handlerCounts[mode as HandlerMode] -= removedCount;
      return;
    }
  }
}

function handleResult(
  isHeadRequest: boolean,
  response: HTTPResult,
  res: ServerResponse,
) {
  if (isHeadRequest) {
    response.sendHeadResponse(res);
  } else {
    response.sendResponse(res);
  }
}

function extractError(error: unknown) {
  if (typeof error === "object" && error && "message" in error) {
    return (error as { message?: unknown }).message ?? error;
  }
  return error;
}

function copyHeaders(source: HTTPResult, target: HTTPResult) {
  if (source === target) {
    return;
  }
  for (const [name, value] of Object.entries(source.peekHeaders() ?? {})) {
    target.addHeader(name, value);
  }
}

function replaceResponse(
  requestContext: RequestContext,
  result: unknown,
  status: number,
) {
  const previousResponse = requestContext.response;
  const response =
    result instanceof HTTPResult ? result : new HTTPResult(status, result);
  copyHeaders(previousResponse, response);
  requestContext.response = response;
}

function setHandlerResponse(requestContext: RequestContext, result: unknown) {
  if (requestContext.response.isStream()) {
    return;
  }
  if (result instanceof HTTPResult) {
    replaceResponse(requestContext, result, 200);
    return;
  }
  requestContext.response.setBody(result || "");
  requestContext.response.setStatus(200);
}

function cloneResponse(response: HTTPResult) {
  const snapshot = new HTTPResult(
    response.getStatus(),
    response.getBody(),
    response.getContentType(),
  );
  copyHeaders(response, snapshot);
  return snapshot;
}

function getMultiHandlers(
  method: string,
  path: string[],
  source: Record<string, RouteLevel>,
) {
  const handlers = getHandler(method, path, source, true);
  return Array.isArray(handlers) ? handlers : [];
}

function executeHandler(
  handler: HandlerResult | RouteCallback,
  requestContext: RequestContext,
) {
  if (typeof handler === "function") {
    return handler(requestContext);
  }
  requestContext.routeParameters = handler.parameters;
  return handler.handler(requestContext);
}

function getThen(value: unknown): ThenCallback | undefined {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return;
  }
  const then = (value as PromiseLikeValue).then;
  return typeof then === "function" ? (then as ThenCallback) : undefined;
}

function resolveThenable(value: unknown, then: ThenCallback): Promise<unknown> {
  if (value instanceof Promise) {
    return value;
  }
  return new Promise((resolve, reject) => {
    queueMicrotask(() => {
      try {
        then.call(value, resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function continueExecution<T, U>(
  value: Awaitable<T>,
  next: (result: T) => Awaitable<U>,
): Awaitable<U> {
  const then = getThen(value);
  if (then) {
    return resolveThenable(value, then).then((result) => next(result as T));
  }
  return next(value as T);
}

function executePriorityHandlers(
  handlers: HandlerResult[],
  requestContext: RequestContext,
  startIndex = 0,
): Awaitable<unknown> {
  if (startIndex === 0 && handlers.length > 1) {
    handlers.sort((a, b) => a.priority - b.priority);
  }
  for (let index = startIndex; index < handlers.length; index += 1) {
    const { handler, parameters } = handlers[index];
    requestContext.routeParameters = parameters;
    const result = handler(requestContext);
    const then = getThen(result);
    if (then) {
      return resolveThenable(result, then).then((resolved) =>
        resolved
          ? resolved
          : executePriorityHandlers(handlers, requestContext, index + 1),
      );
    }
    if (result) {
      return result;
    }
  }
  return undefined;
}

function executeMiddleware(
  mode: MiddlewareMode,
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<unknown> {
  if (handlerCounts[mode] === 0) {
    return undefined;
  }
  const handlers = getMultiHandlers(method, path, roots[mode]);
  if (handlers.length === 0) {
    return undefined;
  }
  return executePriorityHandlers(handlers, requestContext);
}

function runMonitors(
  monitors: HandlerResult[],
  monitorContext: RequestContext,
  startIndex = 0,
): Awaitable<void> {
  if (startIndex === 0 && monitors.length > 1) {
    monitors.sort((a, b) => a.priority - b.priority);
  }
  for (let index = startIndex; index < monitors.length; index += 1) {
    const { handler, parameters } = monitors[index];
    monitorContext.routeParameters = parameters;
    try {
      const result = handler(monitorContext);
      const then = getThen(result);
      if (then) {
        return resolveThenable(result, then).then(
          () => runMonitors(monitors, monitorContext, index + 1),
          (error) => {
            console.error(error);
            return runMonitors(monitors, monitorContext, index + 1);
          },
        );
      }
    } catch (error) {
      console.error(error);
    }
  }
}

function executeMonitors(
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  if (handlerCounts.monitor === 0) {
    return;
  }
  const monitors = getMultiHandlers(method, path, roots.monitor);
  if (monitors.length === 0) {
    return;
  }
  const monitorContext: RequestContext = {
    ...requestContext,
    routeParameters: {},
    response: cloneResponse(requestContext.response),
  };
  return runMonitors(monitors, monitorContext);
}

function setMiddlewareResponse(
  requestContext: RequestContext,
  result: unknown,
): void {
  if (!result) {
    return;
  }
  if (result instanceof HTTPResult || requestContext.response.isStream()) {
    replaceResponse(requestContext, result, 200);
    return;
  }
  requestContext.response.setBody(result);
  requestContext.response.setStatus(200);
}

function executePostfix(
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  const execution = executeMiddleware("postfix", method, path, requestContext);
  return continueExecution(execution, (result) => {
    setMiddlewareResponse(requestContext, result);
  });
}

function executeHandlerAndPostfix(
  handler: HandlerResult | RouteCallback,
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  const execution = executeHandler(handler, requestContext);
  return continueExecution(execution, (result) => {
    setHandlerResponse(requestContext, result);
    return executePostfix(method, path, requestContext);
  });
}

function executeRequest(
  method: string,
  path: string[],
  exactPath: string,
  requestContext: RequestContext,
): Awaitable<void> {
  let handler = getHandler(method, path, roots.handler, false, exactPath);
  if (!handler && method === "head") {
    handler = getHandler("get", path, roots.handler, false, exactPath);
  }
  const selectedHandler = Array.isArray(handler) ? undefined : handler;
  if (!selectedHandler) {
    requestContext.response.setBody("Not Found");
    requestContext.response.setStatus(404);
  }
  if (!selectedHandler && method !== "options") {
    return;
  }
  const prefixExecution = executeMiddleware(
    "prefix",
    method,
    path,
    requestContext,
  );
  return continueExecution(prefixExecution, (prefixResult) => {
    setMiddlewareResponse(requestContext, prefixResult);
    if (prefixResult || !selectedHandler) {
      return;
    }
    return executeHandlerAndPostfix(
      selectedHandler,
      method,
      path,
      requestContext,
    );
  });
}

function completeRequest(
  didFail: boolean,
  error: unknown,
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  if (didFail) {
    replaceResponse(requestContext, extractError(error), 500);
  }
  requestContext.error = error;
  const monitorExecution = executeMonitors(method, path, requestContext);
  return continueExecution(monitorExecution, () =>
    handleResult(
      method === "head",
      requestContext.response,
      requestContext.rawResponse,
    ),
  );
}

function processRequest(
  req: IncomingMessage,
  res: ServerResponse,
  protocol: "http" | "https",
): Awaitable<void> {
  const url = new URL(
    req.url || "",
    `${protocol}://${req.headers.host || "localhost"}`,
  );
  const requestContext: RequestContext = {
    rawRequest: req,
    rawResponse: res,
    url,
    routeParameters: {},
    response: new HTTPResult(),
  };
  const path = url.pathname.split("/").filter((part) => part);
  const method = req.method?.toLowerCase() || "get";

  try {
    const execution = executeRequest(
      method,
      path,
      url.pathname,
      requestContext,
    );
    const then = getThen(execution);
    if (then) {
      return resolveThenable(execution, then).then(
        () => completeRequest(false, undefined, method, path, requestContext),
        (error) => completeRequest(true, error, method, path, requestContext),
      );
    }
  } catch (error) {
    return completeRequest(true, error, method, path, requestContext);
  }
  return completeRequest(false, undefined, method, path, requestContext);
}

export function requestListener(
  req: IncomingMessage,
  res: ServerResponse,
  protocol: "http" | "https",
): Awaitable<void> {
  try {
    return processRequest(req, res, protocol);
  } catch (error) {
    return Promise.reject(error);
  }
}

const wss = new WebSocketServer({ noServer: true });
const upgrader = (req: IncomingMessage, socket: stream.Duplex, head: Buffer) =>
  new Promise<WebSocket>((resolve) =>
    wss.handleUpgrade(req, socket, head, resolve),
  );

export async function upgradeListener(
  req: IncomingMessage,
  socket: stream.Duplex,
  head: Buffer,
  protocol: "ws" | "wss",
) {
  const res = new ServerResponse(req);
  const url = new URL(
    req.url || "",
    `${protocol}://${req.headers.host || "localhost"}`,
  );
  const requestContext: RequestContext = {
    rawRequest: req,
    rawResponse: res,
    url,
    routeParameters: {},
    response: new HTTPResult(404, "Not Found"),
  };

  const path = url.pathname.split("/").filter((part) => part);
  const method = req.method?.toLowerCase() || "get";
  let requestError: unknown;
  let hasUpgradedConnection = false;
  let mustSendResponse = false;
  let mustDestroySocket = false;

  try {
    const handler = getHandler(
      method,
      path,
      roots.websocket,
      false,
      url.pathname,
    );
    if (!handler || Array.isArray(handler)) {
      mustSendResponse = true;
      mustDestroySocket = true;
      // Fall through to finally block to execute monitors.
    } else {
      const prefixExecution = executeMiddleware(
        "prefix",
        method,
        path,
        requestContext,
      );
      const prefixResult = prefixExecution ? await prefixExecution : undefined;
      if (prefixResult) {
        setMiddlewareResponse(requestContext, prefixResult);
        mustSendResponse = true;
        mustDestroySocket = true;
        // Fall through to finally block to execute monitors.
      } else {
        requestContext.connection = await upgrader(req, socket, head);
        hasUpgradedConnection = true;
        await executeHandler(handler, requestContext);
      }
    }
  } catch (error: unknown) {
    requestError = error;
    mustDestroySocket = true;
    if (!hasUpgradedConnection) {
      replaceResponse(requestContext, extractError(error), 500);
      mustSendResponse = true;
    }
  } finally {
    requestContext.error = requestError;
    const monitorExecution = executeMonitors(method, path, requestContext);
    if (monitorExecution) {
      await monitorExecution;
    }
    if (mustSendResponse) {
      handleResult(false, requestContext.response, res);
    }
    if (mustDestroySocket) {
      socket.destroy();
    }
  }
}
