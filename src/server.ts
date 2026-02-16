import { HTTPResult, HandlerPriority } from '@ajs.local/api/beta';
import { IncomingMessage, ServerResponse } from 'http';
import stream from 'stream';
import { WebSocket, WebSocketServer } from 'ws';

export type RouteCallback = (context: RequestContext) => unknown;
export interface IdentifiableRouteCallback {
  id: string;
  callback: RouteCallback;
  priority: HandlerPriority;
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
  sub: RouteLevel;
  mapping: string[];
}

interface CatchAllRoute {
  paramName: string;
  suffix: string[];
  level: RouteLevel;
}

class RouteLevel {
  handlers: IdentifiableRouteCallback[] = [];
  staticRoutes: Record<string, RouteLevel> = {};
  dynamicRoutes: Record<string, DynamicRoute> = {};
  catchAllRoutes: CatchAllRoute[] = [];
}

const roots: Record<string, Record<string, RouteLevel>> = {
  handler: {},
  prefix: {},
  postfix: {},
  monitor: {},
  websocket: {},
};

interface HandlerResult {
  handler: RouteCallback;
  parameters: Record<string, string>;
  priority: HandlerPriority;
}

type HandlerLookupResult = HandlerResult | HandlerResult[] | undefined;

function findHandlers(
  path: string[],
  depth: number,
  level: RouteLevel,
  result: Array<HandlerResult>,
  parameters: Record<string, string>,
  multi = false,
) {
  if (multi) {
    result.push(
      ...level.handlers.map((handler) => ({ handler: handler.callback, parameters, priority: handler.priority })),
    );
  }
  if (depth >= path.length) {
    if (!multi && level.handlers.length > 0) {
      result.push({ handler: level.handlers[0].callback, parameters, priority: level.handlers[0].priority });
    }
    return;
  }

  const part = path[depth];

  if (part in level.staticRoutes) {
    findHandlers(path, depth + 1, level.staticRoutes[part], result, parameters, multi);
    if (result.length > 0 && !multi) {
      return;
    }
  }

  for (const { match, sub, mapping } of Object.values(level.dynamicRoutes)) {
    const res = match.exec(part);
    if (res) {
      const newParameters = { ...parameters };
      for (let i = 0; i < mapping.length; ++i) {
        const parameterName = mapping[i];
        const parameterValue = res[i + 1];
        if (parameterName !== undefined && parameterValue !== undefined) {
          newParameters[parameterName] = parameterValue;
        }
      }
      findHandlers(path, depth + 1, sub, result, newParameters, multi);
      if (result.length > 0 && !multi) {
        return;
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

    const newParameters = { ...parameters, [catchAll.paramName]: captured.join('/') };
    findHandlers(path, path.length, catchAll.level, result, newParameters, multi);
    if (result.length > 0 && !multi) {
      return;
    }
  }
}

function getHandler(
  method: string,
  path: string[],
  source: Record<string, RouteLevel>,
  multi = false,
): HandlerLookupResult {
  const result: Array<HandlerResult> = [];
  if (method in source) {
    findHandlers(path, 0, source[method], result, {}, multi);
    if (result.length > 0 && !multi) {
      return result[0];
    }
  }
  if ('any' in source) {
    findHandlers(path, 0, source.any, result, {}, multi);
    if (result.length > 0 && !multi) {
      return result[0];
    }
  }
  return multi ? result : undefined;
}

function removeHandler(id: string, source: Record<string, RouteLevel>): boolean {
  for (const level of Object.values(source)) {
    const handlerLength = level.handlers.length;
    level.handlers = level.handlers.filter((handler) => handler.id !== id);

    if (handlerLength !== level.handlers.length) {
      return true;
    }

    if (removeHandler(id, level.staticRoutes)) {
      return true;
    }

    if (
      removeHandler(
        id,
        Object.keys(level.dynamicRoutes).reduce(
          (acc, key) => ({ ...acc, [key]: level.dynamicRoutes[key].sub }),
          {} as Record<string, RouteLevel>,
        ),
      )
    ) {
      return true;
    }

    for (const catchAll of level.catchAllRoutes) {
      if (removeHandler(id, { _: catchAll.level })) {
        return true;
      }
    }
  }

  return false;
}

const special = {
  $: true,
  '-': true,
  _: true,
  '.': true,
  '+': true,
  '!': true,
  ' ': true,
  '*': true,
  "'": true,
  '(': true,
  ')': true,
  ',': true,
};
export function registerHandler(
  id: string,
  mode: 'prefix' | 'postfix' | 'handler' | 'monitor' | 'websocket',
  method: string | undefined,
  location: string,
  handler: RouteCallback,
  priority = HandlerPriority.NORMAL,
) {
  const parts = location.split('/').filter((part) => part);
  const source = roots[mode];
  let level = source[method?.toLowerCase() || 'any'];
  if (!level) {
    level = new RouteLevel();
    source[method?.toLowerCase() || 'any'] = level;
  }
  for (let i = 0; i < parts.length; ++i) {
    const part = parts[i];

    if (part.startsWith('::')) {
      const paramName = part.slice(2);
      if (!paramName) {
        throw new Error('Catch-all parameter must have a name');
      }

      const suffix = parts.slice(i + 1);
      for (const suffixPart of suffix) {
        if (suffixPart.indexOf(':') >= 0) {
          throw new Error('Dynamic segments after catch-all are not supported');
        }
      }

      const suffixKey = suffix.join('/');
      let catchAll = level.catchAllRoutes.find(
        (route) => route.paramName === paramName && route.suffix.join('/') === suffixKey,
      );

      if (!catchAll) {
        catchAll = { paramName, suffix, level: new RouteLevel() };
        level.catchAllRoutes.push(catchAll);
      }

      level = catchAll.level;
      break;
    }

    if (part.indexOf(':') >= 0) {
      if (!(part in level.dynamicRoutes)) {
        const mapping = [];
        const match = ['^'];
        let word: string[] | undefined = undefined;
        for (const char of part) {
          if (char in special) {
            if (word) {
              mapping.push(word.join(''));
              match.push(`([^\\${char}]*)`);
              word = undefined;
            }
            match.push('\\' + char);
          } else if (char === ':') {
            if (word) {
              throw new Error('Invalid URL parameter');
            }
            word = [];
          } else if (char.match(/[a-zA-Z0-9]/)) {
            if (word) {
              word.push(char);
            } else {
              match.push(char);
            }
          } else {
            throw new Error('Invalid character in URL');
          }
        }
        if (word) {
          mapping.push(word.join(''));
          match.push(`(.*)`);
        }
        match.push('$');
        level.dynamicRoutes[part] = {
          match: new RegExp(match.join('')),
          sub: new RouteLevel(),
          mapping,
        };
      }
      level = level.dynamicRoutes[part].sub;
    } else {
      if (!(part in level.staticRoutes)) {
        level.staticRoutes[part] = new RouteLevel();
      }
      level = level.staticRoutes[part];
    }
  }
  level.handlers.push({ id, callback: handler, priority });
}

export function unregisterHandler(id: string) {
  for (const source of Object.values(roots)) {
    if (removeHandler(id, source)) {
      return;
    }
  }
}

function handleResult(isHeadRequest: boolean, response: HTTPResult, res: ServerResponse) {
  if (isHeadRequest) {
    response.sendHeadResponse(res);
  } else {
    response.sendResponse(res);
  }
}

function extractError(error: unknown) {
  if (typeof error === 'object' && error && 'message' in error) {
    return (error as { message?: unknown }).message ?? error;
  }
  return error;
}

function setHandlerResponse(requestContext: RequestContext, result: unknown) {
  if (requestContext.response.isStream()) {
    return;
  }
  if (result) {
    requestContext.response = HTTPResult.withHeaders(result, requestContext.response.getHeaders(), 200);
    return;
  }
  requestContext.response = HTTPResult.withHeaders('', requestContext.response.getHeaders(), 200);
}

function cloneResponse(response: HTTPResult) {
  const snapshot = new HTTPResult(response.getStatus(), response.getBody(), response.getContentType());
  for (const [name, value] of Object.entries(response.getHeaders())) {
    snapshot.addHeader(name, value);
  }
  return snapshot;
}

function getMultiHandlers(method: string, path: string[], source: Record<string, RouteLevel>) {
  const handlers = getHandler(method, path, source, true);
  return Array.isArray(handlers) ? handlers : [];
}

async function executePriorityHandlers(handlers: HandlerResult[], requestContext: RequestContext) {
  handlers.sort((a, b) => a.priority - b.priority);
  for (const { handler, parameters } of handlers) {
    requestContext.routeParameters = parameters;
    const result = await handler(requestContext);
    if (result) {
      return result;
    }
  }
  return undefined;
}

async function executeMonitors(method: string, path: string[], requestContext: RequestContext) {
  const monitors = getMultiHandlers(method, path, roots.monitor);
  const monitorContext: RequestContext = {
    ...requestContext,
    routeParameters: {},
    response: cloneResponse(requestContext.response),
  };

  monitors.sort((a, b) => a.priority - b.priority);
  for (const { handler, parameters } of monitors) {
    monitorContext.routeParameters = parameters;
    try {
      await handler(monitorContext);
    } catch (error) {
      console.error(error);
    }
  }
}

export async function requestListener(req: IncomingMessage, res: ServerResponse, protocol: 'http' | 'https') {
  const url = new URL(req.url || '', `${protocol}://${req.headers.host || 'localhost'}`);
  const requestContext: RequestContext = {
    rawRequest: req,
    rawResponse: res,
    url,
    routeParameters: {},
    response: new HTTPResult(404, 'Not Found'),
  };

  const path = url.pathname.split('/').filter((part) => part);
  const method = req.method?.toLowerCase() || 'get';
  const isHeadRequest = method === 'head';
  let requestError: unknown;

  try {
    let handler = getHandler(method, path, roots.handler, false);
    if (!handler && method === 'head') {
      handler = getHandler('get', path, roots.handler, false);
    }
    if (!handler && method !== 'options') {
      return;
    }

    const prefixResult = await executePriorityHandlers(getMultiHandlers(method, path, roots.prefix), requestContext);
    if (prefixResult) {
      requestContext.response = HTTPResult.withHeaders(prefixResult, requestContext.response.getHeaders(), 200);
      return;
    }

    if (!handler && method === 'options') {
      return;
    }

    if (handler && !Array.isArray(handler)) {
      requestContext.routeParameters = handler.parameters;
      const result = await handler.handler(requestContext);
      setHandlerResponse(requestContext, result);
    }

    const postfixResult = await executePriorityHandlers(getMultiHandlers(method, path, roots.postfix), requestContext);
    if (postfixResult) {
      requestContext.response = HTTPResult.withHeaders(postfixResult, requestContext.response.getHeaders(), 200);
    }
  } catch (error: unknown) {
    requestError = error;
    requestContext.response = HTTPResult.withHeaders(extractError(error), requestContext.response.getHeaders(), 500);
  } finally {
    requestContext.error = requestError;
    await executeMonitors(method, path, requestContext);
    handleResult(isHeadRequest, requestContext.response, res);
  }
}

const wss = new WebSocketServer({ noServer: true });
const upgrader = (req: IncomingMessage, socket: stream.Duplex, head: Buffer) =>
  new Promise<WebSocket>((resolve) => wss.handleUpgrade(req, socket, head, resolve));

export async function upgradeListener(
  req: IncomingMessage,
  socket: stream.Duplex,
  head: Buffer,
  protocol: 'ws' | 'wss',
) {
  const res = new ServerResponse(req);
  const url = new URL(req.url || '', `${protocol}://${req.headers.host || 'localhost'}`);
  const requestContext: RequestContext = {
    rawRequest: req,
    rawResponse: res,
    url,
    routeParameters: {},
    response: new HTTPResult(404, 'Not Found'),
  };

  const path = url.pathname.split('/').filter((part) => part);
  const method = req.method?.toLowerCase() || 'get';
  let requestError: unknown;
  let hasUpgradedConnection = false;
  let mustSendResponse = false;
  let mustDestroySocket = false;

  try {
    const handler = getHandler(method, path, roots.websocket, false);
    if (!handler || Array.isArray(handler)) {
      mustSendResponse = true;
      mustDestroySocket = true;
      return;
    }

    const prefixResult = await executePriorityHandlers(getMultiHandlers(method, path, roots.prefix), requestContext);
    if (prefixResult) {
      requestContext.response = HTTPResult.withHeaders(prefixResult, requestContext.response.getHeaders(), 200);
      mustSendResponse = true;
      mustDestroySocket = true;
      return;
    }

    requestContext.connection = await upgrader(req, socket, head);
    hasUpgradedConnection = true;
    requestContext.routeParameters = handler.parameters;
    await handler.handler(requestContext);
  } catch (error: unknown) {
    requestError = error;
    mustDestroySocket = true;
    if (!hasUpgradedConnection) {
      requestContext.response = HTTPResult.withHeaders(extractError(error), requestContext.response.getHeaders(), 500);
      mustSendResponse = true;
    }
  } finally {
    requestContext.error = requestError;
    await executeMonitors(method, path, requestContext);
    if (mustSendResponse) {
      handleResult(false, requestContext.response, res);
    }
    if (mustDestroySocket) {
      socket.destroy();
    }
  }
}
