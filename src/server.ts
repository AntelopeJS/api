import { HTTPResult, HandlerPriority } from '@ajs.local/api/beta';
import { IncomingMessage, ServerResponse } from 'http';
import stream from 'stream';
import { WebSocket, WebSocketServer } from 'ws';

export type RouteCallback = (context: RequestContext) => any;
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
  connection?: unknown /* WebsocketConnection */;
}

class RouteLevel {
  handlers: IdentifiableRouteCallback[] = [];
  staticRoutes: Record<string, RouteLevel> = {};
  dynamicRoutes: Record<string, { match: RegExp; sub: RouteLevel; mapping: string[] }> = {};
}

const roots: Record<string, Record<string, RouteLevel>> = {
  handler: {},
  prefix: {},
  postfix: {},
  websocket: {},
};

type HandlerResult = { handler: RouteCallback; parameters: Record<string, string>; priority: HandlerPriority };
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
        newParameters[mapping[i]] = res[i + 1];
      }
      findHandlers(path, depth + 1, sub, result, newParameters, multi);
      if (result.length > 0 && !multi) {
        return;
      }
    }
  }
}

function getHandler(method: string, path: string[], source: Record<string, RouteLevel>, multi = false) {
  const result: Array<HandlerResult> = [];
  // check source[method]
  if (method in source) {
    findHandlers(path, 0, source[method], result, {}, multi);
    if (result.length > 0 && !multi) {
      return result[0];
    }
  }
  // if multi or not found: check source['any']
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
  mode: 'prefix' | 'postfix' | 'handler' | 'websocket',
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
  for (const part of parts) {
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

  try {
    let handler = getHandler(method, path, roots.handler, false);
    if (!handler && method === 'head') {
      handler = getHandler('get', path, roots.handler, false);
    }
    if (!handler && method !== 'options') {
      handleResult(isHeadRequest, requestContext.response, res);
      return;
    }

    const prefixHandler = getHandler(method, path, roots.prefix, true);
    if (prefixHandler && Array.isArray(prefixHandler)) {
      prefixHandler.sort((a, b) => a.priority - b.priority);
      for (const { handler, parameters } of prefixHandler) {
        requestContext.routeParameters = parameters;
        const result = await handler(requestContext);
        if (result) {
          handleResult(isHeadRequest, HTTPResult.withHeaders(result, requestContext.response.getHeaders(), 200), res);
          return;
        }
      }
    }

    if (!handler && method === 'options') {
      handleResult(isHeadRequest, requestContext.response, res);
      return;
    }

    if (handler && !Array.isArray(handler)) {
      requestContext.routeParameters = handler.parameters;
      const result = await handler.handler(requestContext);
      if (!requestContext.response.isStream()) {
        if (result) {
          requestContext.response = HTTPResult.withHeaders(result, requestContext.response.getHeaders(), 200);
        } else {
          requestContext.response = HTTPResult.withHeaders('', requestContext.response.getHeaders(), 200);
        }
      }
    }

    const postfixHandler = getHandler(method, path, roots.postfix, true);
    if (postfixHandler && Array.isArray(postfixHandler)) {
      postfixHandler.sort((a, b) => a.priority - b.priority);
      for (const { handler, parameters } of postfixHandler) {
        requestContext.routeParameters = parameters;
        const result = await handler(requestContext);
        if (result) {
          handleResult(isHeadRequest, HTTPResult.withHeaders(result, requestContext.response.getHeaders(), 200), res);
          return;
        }
      }
    }

    handleResult(isHeadRequest, requestContext.response, res);
  } catch (err: any) {
    handleResult(
      isHeadRequest,
      HTTPResult.withHeaders(err.message || err, requestContext.response.getHeaders(), 500),
      res,
    );
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

  try {
    const handler = getHandler(method, path, roots.websocket, false);
    if (!handler) {
      handleResult(false, requestContext.response, res);
      socket.destroy();
      return;
    }

    const prefixHandler = getHandler(method, path, roots.prefix, true);
    if (prefixHandler && Array.isArray(prefixHandler)) {
      prefixHandler.sort((a, b) => a.priority - b.priority);
      for (const { handler, parameters } of prefixHandler) {
        requestContext.routeParameters = parameters;
        const result = await handler(requestContext);
        if (result) {
          handleResult(false, HTTPResult.withHeaders(result, requestContext.response.getHeaders(), 200), res);
          socket.destroy();
          return;
        }
      }
    }

    if (handler && !Array.isArray(handler)) {
      requestContext.connection = await upgrader(req, socket, head);
      requestContext.routeParameters = handler.parameters;
      await handler.handler(requestContext);
    } else {
      socket.destroy();
    }
  } catch (err: unknown) {
    handleResult(false, HTTPResult.withHeaders(err, requestContext.response.getHeaders(), 500), res);
    socket.destroy();
  }
}

// Websocket: mode 'websocket', set context.connection to ws connection
//  https://www.npmjs.com/package/ws -> Multiple servers sharing a single HTTP/S server

// SSE: https://github.com/andywer/http-event-stream/blob/HEAD/dist/index.d.ts
