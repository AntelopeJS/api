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
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<RouteResult> {
  if (!hasHandlers(mode)) {
    return undefined;
  }
  const handlers = getMultiHandlers(method, path, mode);
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
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  if (!hasHandlers("monitor")) {
    return;
  }
  const monitors = getMultiHandlers(method, path, "monitor");
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
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  const execution = executeMiddleware("postfix", method, path, requestContext);
  return continueWith(execution, (result) => {
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
  return continueWith(execution, (result) => {
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
  let handler = findRouteHandler("handler", method, path, exactPath);
  if (!handler && method === "head") {
    handler = findRouteHandler("handler", "get", path, exactPath);
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
  return continueWith(prefixExecution, (prefixResult) => {
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
  error: RequestContext["error"],
  method: string,
  path: string[],
  requestContext: RequestContext,
): Awaitable<void> {
  if (didFail) {
    replaceResponse(requestContext, errorResponse(error), 500);
  }
  requestContext.error = error;
  const monitorExecution = executeMonitors(method, path, requestContext);
  return continueWith(monitorExecution, () =>
    handleResult(
      method === "head",
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

  try {
    const execution = executeRequest(
      method,
      path,
      url.pathname,
      requestContext,
    );
    const pending = pendingOf(execution);
    if (pending) {
      return pending.then(
        () => completeRequest(false, undefined, method, path, requestContext),
        (error: unknown) =>
          completeRequest(true, error, method, path, requestContext),
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

  if (answerFromGate(requestContext)) {
    handleResult(false, requestContext.response, res);
    socket.destroy();
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
        method,
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
