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

function closeConnectionAfter(response: http.ServerResponse): void {
  if (!response.headersSent) {
    response.setHeader("Connection", "close");
  }
}

/**
 * Once `server` closes, every response it still sends tells the client to
 * close the connection, so a keep-alive connection ends with its last
 * in-flight request instead of holding `stop` for the whole shutdown
 * grace period.
 */
function closeConnectionsOnceClosed(server: net.Server): void {
  const inFlight = new Set<http.ServerResponse>();
  let closed = false;

  server.on(
    "request",
    (_req: http.IncomingMessage, res: http.ServerResponse) => {
      if (closed) {
        closeConnectionAfter(res);
        return;
      }
      inFlight.add(res);
      res.once("close", () => inFlight.delete(res));
    },
  );
  server.once("close", () => {
    closed = true;
    inFlight.forEach(closeConnectionAfter);
    inFlight.clear();
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
