import * as http from "node:http";
import * as https from "node:https";
import type * as net from "node:net";
import type stream from "node:stream";

import { requestListener, upgradeListener } from "./server";
import type {
  HTTPConfig,
  HTTPSConfig,
  ServerConfig,
  ServerProtocol,
  SocketProtocol,
} from "./server-config";

interface ConfigByProtocol {
  http: HTTPConfig;
  https: HTTPSConfig;
}

type ServerFactories = {
  [P in ServerProtocol]: (config: ConfigByProtocol[P]) => net.Server;
};

function closesConnection(
  response: http.ServerResponse | undefined,
  closes: boolean,
): void {
  if (!response || response.headersSent) {
    return;
  }
  if (closes) {
    response.setHeader("Connection", "close");
    return;
  }
  response.removeHeader("Connection");
}

/**
 * Once `server` closes, the last response it owes on each connection tells
 * the client to close it, so a keep-alive connection ends with its last
 * in-flight request instead of holding `stop` for the whole shutdown grace
 * period. Only the last one: Node ends a connection after a
 * `Connection: close` response, which would drop the pipelined responses
 * queued behind it.
 */
function closeConnectionsOnceClosed(server: net.Server): void {
  const pending = new Map<net.Socket, http.ServerResponse[]>();
  let closed = false;

  server.on(
    "request",
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const responses = pending.get(req.socket) ?? [];
      const previous = responses.at(-1);
      responses.push(res);
      pending.set(req.socket, responses);
      res.once("close", () => {
        responses.splice(responses.indexOf(res), 1);
        if (responses.length === 0) {
          pending.delete(req.socket);
        }
      });
      if (closed) {
        closesConnection(previous, false);
        closesConnection(res, true);
      }
    },
  );
  server.once("close", () => {
    closed = true;
    pending.forEach((responses) => closesConnection(responses.at(-1), true));
  });
}

function attachServerListeners(
  server: net.Server,
  protocol: ServerProtocol,
  socketProtocol: SocketProtocol,
): void {
  closeConnectionsOnceClosed(server);
  server.on(
    "request",
    (req: http.IncomingMessage, res: http.ServerResponse) =>
      void requestListener(req, res, protocol),
  );
  server.on(
    "upgrade",
    (req: http.IncomingMessage, socket: stream.Duplex, head: Buffer) =>
      void upgradeListener(req, socket, head, socketProtocol),
  );
}

function createHTTPServer(config: HTTPConfig): net.Server {
  const server = http.createServer(config);
  attachServerListeners(server, "http", "ws");
  return server;
}

function createHTTPSServer(config: HTTPSConfig): net.Server {
  const server = https.createServer(config);
  attachServerListeners(server, "https", "wss");
  return server;
}

const SERVER_FACTORY_BY_PROTOCOL: ServerFactories = {
  http: (config) => createHTTPServer(config),
  https: (config) => createHTTPSServer(config),
};

function createServerFor<P extends ServerProtocol>(
  config: ConfigByProtocol[P] & { protocol: P },
): net.Server {
  return SERVER_FACTORY_BY_PROTOCOL[config.protocol](config);
}

export function createConfiguredServer(config: ServerConfig): net.Server {
  return createServerFor(config);
}
