import * as net from "node:net";

import type { ServerConfig } from "./server-config";
import {
  buildCandidatePorts,
  isPortInUseError,
  resolveBoundPort,
  resolveRequestedPort,
} from "./port-binding";

interface ListenerAddress {
  host?: string;
  /** The port read from the bound socket. */
  port: number;
  /** The port the configuration asked for, before any fallback. */
  requestedPort: number;
}

/**
 * The listening socket of a configured server, bound once and served later.
 *
 * The socket is bound during `provide`, so the published `API_PORT` is
 * the port read back from it, and it stays open until `stop`: the http or
 * https server never binds a port of its own. Connections accepted before
 * `serve` are queued paused and unread, then handed to the server with
 * everything that follows, like Go's `net.Listen` followed by
 * `http.Serve`.
 */
export interface BoundListener extends ListenerAddress {
  /** The bound socket, as the dev registry reads it. */
  socket: net.Server;
  /** Hands every queued and future connection to `server`. */
  serve: (server: net.Server) => void;
  /** Stops accepting, drops unserved connections and frees the port. */
  close: () => Promise<void>;
}

/**
 * Raised when no port could be bound for a configured server.
 */
export class PortReservationError extends Error {
  override readonly name = "PortReservationError";
  readonly code = "EADDRINUSE";
}

interface ListenAttempt {
  socket?: net.Server;
  error?: unknown;
}

const STRICT_PORT_HINT =
  " Port fallback is disabled; set strictPort to false in development to accept the next free port.";

function listenOnce(port: number, host?: string): Promise<ListenAttempt> {
  return new Promise((resolve) => {
    const socket = net.createServer({ pauseOnConnect: true });
    socket.once("error", (error: Error) => resolve({ error }));
    socket.listen({ port, host }, () => resolve({ socket }));
  });
}

/**
 * Hands a paused connection to `server`. Emitting `connection` is how a
 * server takes over a socket it did not accept; https wraps it in TLS.
 */
function handOver(server: net.Server, connection: net.Socket): void {
  server.emit("connection", connection);
  connection.resume();
}

/**
 * Makes `server` treat `connection` events as its own. The server never
 * calls `listen()`, and `listening` is the event that arms its connection
 * tracking: request and headers timeouts, and closing idle keep-alive
 * connections on `close()`.
 */
function adoptAsListening(server: net.Server): void {
  server.emit("listening");
}

/**
 * Turns a bound socket into a listener. Until served it does not keep the
 * process alive, so a boot that fails after `provide` still exits.
 */
function createListener(
  socket: net.Server,
  address: ListenerAddress,
): BoundListener {
  const queued = new Set<net.Socket>();
  let target: net.Server | undefined;

  socket.unref();
  socket.on("connection", (connection: net.Socket) => {
    if (target) {
      handOver(target, connection);
      return;
    }
    queued.add(connection);
    connection.once("close", () => queued.delete(connection));
  });

  return {
    ...address,
    socket,
    serve: (server) => {
      target = server;
      socket.ref();
      adoptAsListening(server);
      queued.forEach((connection) => handOver(server, connection));
      queued.clear();
    },
    close: () =>
      new Promise((resolve) => {
        socket.close(() => resolve());
        queued.forEach((connection) => connection.destroy());
      }),
  };
}

function buildBindError(
  config: ServerConfig,
  requestedPort: number,
  allowPortFallback: boolean,
): PortReservationError {
  const reason = `Unable to bind port ${requestedPort} for the ${config.protocol} server: the port is already in use.`;
  return new PortReservationError(
    allowPortFallback ? reason : `${reason}${STRICT_PORT_HINT}`,
  );
}

/**
 * Binds the port a server is configured for, falling back to the next
 * free ports then to an OS-assigned one when `allowPortFallback` is set.
 */
async function bindListener(
  config: ServerConfig,
  allowPortFallback: boolean,
): Promise<BoundListener> {
  const requestedPort = resolveRequestedPort(config);

  for (const candidatePort of buildCandidatePorts(
    requestedPort,
    allowPortFallback,
  )) {
    const { socket, error } = await listenOnce(candidatePort, config.host);
    if (socket) {
      return createListener(socket, {
        host: config.host,
        port: resolveBoundPort(socket, candidatePort),
        requestedPort,
      });
    }
    if (!isPortInUseError(error)) {
      throw error;
    }
  }

  throw buildBindError(config, requestedPort, allowPortFallback);
}

/**
 * Binds a listener for every configured server and writes the bound port
 * back into its configuration, so the published config variables and the
 * served socket agree on a single value.
 */
export async function bindServerPorts(
  configs: ServerConfig[],
  allowPortFallback: boolean,
): Promise<BoundListener[]> {
  const listeners: BoundListener[] = [];

  try {
    for (const config of configs) {
      const listener = await bindListener(config, allowPortFallback);
      config.port = listener.port;
      listeners.push(listener);
    }
  } catch (error) {
    await closeListeners(listeners);
    throw error;
  }

  return listeners;
}

/**
 * Tells whether `listeners` are bound exactly where `configs` ask, so
 * they can keep serving instead of being bound again.
 */
export function isBoundFor(
  listeners: BoundListener[],
  configs: ServerConfig[],
): boolean {
  return (
    listeners.length === configs.length &&
    listeners.every(
      (listener, index) =>
        listener.host === configs[index].host &&
        listener.port === resolveRequestedPort(configs[index]),
    )
  );
}

/**
 * Closes every listener, freeing their ports.
 */
export function closeListeners(listeners: BoundListener[]): Promise<void> {
  return Promise.all(listeners.map((listener) => listener.close())).then(
    () => undefined,
  );
}
