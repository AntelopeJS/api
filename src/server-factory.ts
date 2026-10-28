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

function attachServerListeners(
  server: net.Server,
  protocol: ServerProtocol,
  socketProtocol: SocketProtocol,
): void {
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
