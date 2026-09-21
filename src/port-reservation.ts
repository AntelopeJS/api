import * as net from "node:net";

import type { ServerConfig } from "./server-config";
import {
  buildCandidatePorts,
  isPortInUseError,
  resolveBoundPort,
  resolveRequestedPort,
} from "./port-binding";

/**
 * A port held open by a throwaway socket between `construct` and `start`.
 *
 * Holding the socket is what keeps the published `API_PORT` and the port
 * the server eventually binds in sync: the probe-then-use race shrinks to
 * the instant between `release()` and the real `listen()`, instead of
 * spanning the construction of every other module.
 */
export interface ReservedPort {
  port: number;
  /** Closes the holding socket; call it right before the real `listen()`. */
  release: () => Promise<void>;
}

/**
 * Raised when no port could be held for a configured server.
 */
export class PortReservationError extends Error {
  override readonly name = "PortReservationError";
  readonly code = "EADDRINUSE";
}

interface PortHold {
  holder?: net.Server;
  error?: unknown;
}

const STRICT_PORT_HINT =
  " Port fallback is disabled; set strictPort to false in development to accept the next free port.";

function holdPort(port: number, host?: string): Promise<PortHold> {
  return new Promise((resolve) => {
    const holder = net.createServer();
    holder.unref();
    holder.once("error", (error: Error) => resolve({ error }));
    holder.listen({ port, host }, () => resolve({ holder }));
  });
}

function closeHolder(holder: net.Server): Promise<void> {
  return new Promise((resolve) => {
    holder.close(() => resolve());
  });
}

function buildReservationError(
  config: ServerConfig,
  requestedPort: number,
  allowPortFallback: boolean,
): PortReservationError {
  const reason = `Unable to reserve port ${requestedPort} for the ${config.protocol} server: the port is already in use.`;
  return new PortReservationError(
    allowPortFallback ? reason : `${reason}${STRICT_PORT_HINT}`,
  );
}

/**
 * Holds the port a server will later bind, honouring the same requested
 * port, fallback range and random-port semantics as the real `listen()`.
 */
async function reservePort(
  config: ServerConfig,
  allowPortFallback: boolean,
): Promise<ReservedPort> {
  const requestedPort = resolveRequestedPort(config);

  for (const candidatePort of buildCandidatePorts(
    requestedPort,
    allowPortFallback,
  )) {
    const { holder, error } = await holdPort(candidatePort, config.host);
    if (holder) {
      return {
        port: resolveBoundPort(holder, candidatePort),
        release: () => closeHolder(holder),
      };
    }
    if (!isPortInUseError(error)) {
      throw error;
    }
  }

  throw buildReservationError(config, requestedPort, allowPortFallback);
}

/**
 * Reserves a port for every configured server and writes the reserved
 * port back into its configuration, so the published config variables and
 * the later `listen()` agree on a single value.
 */
export async function reserveServerPorts(
  configs: ServerConfig[],
  allowPortFallback: boolean,
): Promise<ReservedPort[]> {
  const reservations: ReservedPort[] = [];

  try {
    for (const config of configs) {
      const reservation = await reservePort(config, allowPortFallback);
      config.port = reservation.port;
      reservations.push(reservation);
    }
  } catch (error) {
    await releaseReservedPorts(reservations);
    throw error;
  }

  return reservations;
}

/**
 * Closes every holding socket, freeing the ports for their real servers.
 */
export function releaseReservedPorts(
  reservations: ReservedPort[],
): Promise<void> {
  return Promise.all(
    reservations.map((reservation) => reservation.release()),
  ).then(() => undefined);
}
