import { Socket } from "node:net";
import type stream from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { type IncomingMessage, ServerResponse } from "node:http";
import { HTTPResult } from "@antelopejs/interface-api";

import { gateResponse } from "./startup-gate";
import { applyCors } from "./middlewares/cors";
import { type Awaitable, continueWith, pendingOf } from "./thenable";
import type {
  RequestContext,
  RouteCallback,
  RouteResult,
} from "./request-context";
import {
  findRouteHandler,
  getMultiHandlers,
  type HandlerResult,
  hasHandlers,
} from "./route-table";

export type {
  RequestContext,
  RouteCallback,
  RouteResult,
} from "./request-context";
export { registerHandler, unregisterHandler } from "./route-table";

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

function hasMessage(
  error: RequestContext["error"],
): error is { message: RequestContext["error"] } {
  return typeof error === "object" && error !== null && "message" in error;
}

function isText(value: RequestContext["error"]): value is string {
  return typeof value === "string";
}

/**
 * The 500 answer for a thrown value: a thrown `HTTPResult` as is, else the
 * value's `message` (or the value itself) as text when it is a string or
 * `undefined`, and as its JSON text otherwise.
 */
function errorResponse(error: RequestContext["error"]): HTTPResult {
  const value = hasMessage(error) ? (error.message ?? error) : error;
  if (value instanceof HTTPResult) {
    return value;
  }
  if (value === undefined || isText(value)) {
    return new HTTPResult(500, value);
  }
  return new HTTPResult(500, JSON.stringify(value), "application/json");
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
  result: RouteResult,
  status: number,
) {
  const previousResponse = requestContext.response;
  const response =
    result instanceof HTTPResult
      ? result
      : new HTTPResult(status, result === undefined ? undefined : result);
  copyHeaders(previousResponse, response);
  requestContext.response = response;
}

function setHandlerResponse(
  requestContext: RequestContext,
  result: RouteResult,
) {
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

function isRouteCallback(
  handler: HandlerResult | RouteCallback,
): handler is RouteCallback {
  return typeof handler === "function";
}

function executeHandler(
  handler: HandlerResult | RouteCallback,
  requestContext: RequestContext,
) {
  if (isRouteCallback(handler)) {
    return handler(requestContext);
  }
  requestContext.routeParameters = handler.parameters;
  return handler.handler(requestContext);
}

function executePriorityHandlers(
  handlers: HandlerResult[],
  requestContext: RequestContext,
  startIndex = 0,
): Awaitable<RouteResult> {
  if (startIndex === 0 && handlers.length > 1) {
    handlers.sort((a, b) => a.priority - b.priority);
  }
  for (let index = startIndex; index < handlers.length; index += 1) {
    const { handler, parameters } = handlers[index];
    requestContext.routeParameters = parameters;
    const result = handler(requestContext);
    const pending = pendingOf(result);
    if (pending) {
      return pending.then((resolved) =>
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
  mode: "prefix" | "postfix",
  methods: readonly string[],
  path: string[],
  requestContext: RequestContext,
): Awaitable<RouteResult> {
  if (!hasHandlers(mode)) {
    return undefined;
  }
  const handlers = getMultiHandlers(methods, path, mode);
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
      const pending = pendingOf(result);
      if (pending) {
        return pending.then(
          () => runMonitors(monitors, monitorContext, index + 1),
          (error: unknown) => {
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
  methods: readonly string[],
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  if (!hasHandlers("monitor")) {
    return;
  }
  const monitors = getMultiHandlers(methods, path, "monitor");
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
  result: RouteResult,
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
  methods: readonly string[],
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  const execution = executeMiddleware("postfix", methods, path, requestContext);
  return continueWith(execution, (result) => {
    setMiddlewareResponse(requestContext, result);
  });
}

function executeHandlerAndPostfix(
  handler: HandlerResult | RouteCallback,
  methods: readonly string[],
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  const execution = executeHandler(handler, requestContext);
  return continueWith(execution, (result) => {
    setHandlerResponse(requestContext, result);
    return executePostfix(methods, path, requestContext);
  });
}

/** The handler a request runs and the methods its prefixes, postfixes and monitors are registered under. */
interface SelectedRoute {
  method: string;
  handler: HandlerResult | RouteCallback | undefined;
  methods: readonly string[];
}

function asSingleHandler(
  handler: ReturnType<typeof findRouteHandler>,
): HandlerResult | RouteCallback | undefined {
  return Array.isArray(handler) ? undefined : handler;
}

/**
 * Selects the handler for a request. A HEAD request without a HEAD handler
 * runs the GET handler, together with the HEAD and the GET middleware.
 */
function selectRoute(
  method: string,
  path: string[],
  exactPath: string,
): SelectedRoute {
  const handler = findRouteHandler("handler", method, path, exactPath);
  if (handler || method !== "head") {
    return { method, handler: asSingleHandler(handler), methods: [method] };
  }
  const getHandler = asSingleHandler(
    findRouteHandler("handler", "get", path, exactPath),
  );
  return {
    method,
    handler: getHandler,
    methods: getHandler ? [method, "get"] : [method],
  };
}

function executeRequest(
  route: SelectedRoute,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  const { method, handler: selectedHandler, methods } = route;
  if (!selectedHandler) {
    requestContext.response.setBody("Not Found");
    requestContext.response.setStatus(404);
  }
  if (!selectedHandler && method !== "options") {
    return;
  }
  const prefixExecution = executeMiddleware(
    "prefix",
    methods,
    path,
    requestContext,
  );
  return continueWith(prefixExecution, (prefixResult) => {
    setMiddlewareResponse(requestContext, prefixResult);
    if (prefixResult || !selectedHandler) {
      return;
    }
    return executeHandlerAndPostfix(
      selectedHandler,
      methods,
      path,
      requestContext,
    );
  });
}

function completeRequest(
  didFail: boolean,
  error: RequestContext["error"],
  route: SelectedRoute,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  if (didFail) {
    replaceResponse(requestContext, errorResponse(error), 500);
  }
  requestContext.error = error;
  const monitorExecution = executeMonitors(route.methods, path, requestContext);
  return continueWith(monitorExecution, () =>
    handleResult(
      route.method === "head",
      requestContext.response,
      requestContext.rawResponse,
    ),
  );
}

/**
 * Answers a request the startup gate holds back. CORS goes first, so a
 * browser can complete its preflight and read the 503. No route,
 * middleware or monitor runs: modules may not be ready for them.
 */
function answerFromGate(requestContext: RequestContext): boolean {
  const gated = gateResponse(requestContext);
  if (!gated) {
    return false;
  }
  replaceResponse(requestContext, applyCors(requestContext) ?? gated, 200);
  return true;
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
  if (answerFromGate(requestContext)) {
    return handleResult(
      req.method === "HEAD",
      requestContext.response,
      requestContext.rawResponse,
    );
  }
  const path = url.pathname.split("/").filter((part) => part);
  const method = req.method?.toLowerCase() || "get";

  const route = selectRoute(method, path, url.pathname);

  try {
    const execution = executeRequest(route, path, requestContext);
    const pending = pendingOf(execution);
    if (pending) {
      return pending.then(
        () => completeRequest(false, undefined, route, path, requestContext),
        (error: unknown) =>
          completeRequest(true, error, route, path, requestContext),
      );
    }
  } catch (error) {
    return completeRequest(true, error, route, path, requestContext);
  }
  return completeRequest(false, undefined, route, path, requestContext);
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

/**
 * Answers an upgrade request with `response` instead of switching protocols,
 * then closes the socket once the answer is flushed, so the client reads the
 * status and body rather than a dropped connection.
 */
function refuseUpgrade(
  response: HTTPResult,
  res: ServerResponse,
  socket: stream.Duplex,
): void {
  if (!(socket instanceof Socket)) {
    socket.destroy();
    return;
  }
  res.assignSocket(socket);
  res.shouldKeepAlive = false;
  res.on("finish", () => socket.destroy());
  handleResult(false, response, res);
}

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

  if (answerFromGate(requestContext)) {
    refuseUpgrade(requestContext.response, res, socket);
    return;
  }
  const path = url.pathname.split("/").filter((part) => part);
  const method = req.method?.toLowerCase() || "get";
  let requestError: unknown;
  let hasUpgradedConnection = false;
  let mustSendResponse = false;
  let mustDestroySocket = false;

  try {
    const handler = findRouteHandler("websocket", method, path, url.pathname);
    if (!handler || Array.isArray(handler)) {
      mustSendResponse = true;
      mustDestroySocket = true;
    } else {
      const prefixExecution = executeMiddleware(
        "prefix",
        [method],
        path,
        requestContext,
      );
      const prefixResult = prefixExecution
        ? await Promise.resolve(prefixExecution)
        : undefined;
      if (prefixResult) {
        setMiddlewareResponse(requestContext, prefixResult);
        mustSendResponse = true;
        mustDestroySocket = true;
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
      replaceResponse(requestContext, errorResponse(error), 500);
      mustSendResponse = true;
    }
  } finally {
    requestContext.error = requestError;
    const monitorExecution = executeMonitors([method], path, requestContext);
    if (monitorExecution) {
      await monitorExecution;
    }
    if (mustSendResponse) {
      refuseUpgrade(requestContext.response, res, socket);
    } else if (mustDestroySocket) {
      socket.destroy();
    }
  }
}
