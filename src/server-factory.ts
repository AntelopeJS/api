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

/**
 * Asks the client to close the connection after its only pending response,
 * so it does not send another request the server would then end the
 * connection under. With more pending it asks nothing: Node ends a
 * connection after a `Connection: close` response, which would drop the
 * pipelined responses queued behind it.
 */
function announceClose(
  responses: http.ServerResponse[],
  announced: WeakSet<http.ServerResponse>,
): void {
  const [response, ...queued] = responses;
  if (response && queued.length === 0 && !response.headersSent) {
    response.setHeader("Connection", "close");
    announced.add(response);
  }
}

function withdrawClose(
  responses: http.ServerResponse[],
  announced: WeakSet<http.ServerResponse>,
): void {
  responses
    .filter((response) => announced.has(response) && !response.headersSent)
    .forEach((response) => {
      response.removeHeader("Connection");
      announced.delete(response);
    });
}

/**
 * Ends `socket` and drops it once the end is written, as Node does after a
 * `Connection: close` response, so a request the client sends before it
 * reads the end is never handled without an answer.
 */
function endSocket(socket: net.Socket): void {
  socket.end(() => socket.destroy());
}

/**
 * Once `server` closes, ends each connection when its last pending
 * response is done, so a keep-alive connection ends with its last
 * in-flight request instead of holding `stop` for the whole shutdown grace
 * period. Connections idle at that moment are closed by `server.close()`
 * itself; this does the same for the ones that become idle afterwards.
 */
function endConnectionsOnceClosed(server: net.Server): void {
  const pending = new Map<net.Socket, http.ServerResponse[]>();
  const announced = new WeakSet<http.ServerResponse>();
  let closed = false;

  server.on(
    "request",
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const socket = req.socket;
      const responses = pending.get(socket) ?? [];
      if (closed) {
        withdrawClose(responses, announced);
      }
      responses.push(res);
      pending.set(socket, responses);
      if (closed) {
        announceClose(responses, announced);
      }
      res.once("close", () => {
        responses.splice(responses.indexOf(res), 1);
        if (responses.length > 0) {
          if (closed) {
            announceClose(responses, announced);
          }
          return;
        }
        pending.delete(socket);
        if (closed) {
          endSocket(socket);
        }
      });
    },
  );
  server.once("close", () => {
    closed = true;
    pending.forEach((responses) => announceClose(responses, announced));
  });
}

function attachServerListeners(
  server: net.Server,
  protocol: ServerProtocol,
  socketProtocol: SocketProtocol,
): void {
  endConnectionsOnceClosed(server);
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
