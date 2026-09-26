import type * as net from "node:net";
import { Logging } from "@antelopejs/interface-core/logging";

import { buildServerOrigin } from "./server-origin";
import {
  DEFAULT_HTTP_PORT,
  RANDOM_PORT,
  type ServerConfig,
} from "./server-config";

const MAX_PORT_FALLBACK_OFFSET = 20;

export function isPortInUseError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EADDRINUSE";
}

export function resolveBoundPort(
  server: net.Server,
  fallbackPort: number,
): number {
  const address = server.address();
  if (address && typeof address === "object") {
    return address.port;
  }

  return fallbackPort;
}

const MAX_PORT = 65535;

export function resolveRequestedPort(config: ServerConfig): number {
  const rawPort = config.port ?? DEFAULT_HTTP_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < RANDOM_PORT || port > MAX_PORT) {
    throw new Error(
      `Invalid ${config.protocol} server port: ${JSON.stringify(rawPort)}`,
    );
  }
  return port;
}

export function buildCandidatePorts(
  requestedPort: number,
  allowPortFallback: boolean,
): number[] {
  if (!allowPortFallback || requestedPort === RANDOM_PORT) {
    return [requestedPort];
  }

  const sequentialPorts = Array.from(
    { length: MAX_PORT_FALLBACK_OFFSET + 1 },
    (_, offset) => requestedPort + offset,
  );
  return [...sequentialPorts, RANDOM_PORT];
}

/**
 * Logs where a server listens, naming the fallback when it moved.
 */
export function logServerStarted(
  config: ServerConfig,
  requestedPort: number,
  boundPort: number,
): void {
  const serverUrl = buildServerOrigin(config, boundPort);
  if (boundPort === requestedPort || requestedPort === RANDOM_PORT) {
    Logging.Info(`Server started, listening on ${serverUrl}`);
    return;
  }

  Logging.Info(
    `Port ${requestedPort} in use, listening on ${serverUrl} instead`,
  );
}
