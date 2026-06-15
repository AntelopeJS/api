import type * as net from "node:net";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  DEFAULT_HOST,
  DEFAULT_HTTP_PORT,
  RANDOM_PORT,
  type ServerConfig,
} from "./server-config";

const MAX_PORT_FALLBACK_OFFSET = 20;

function listenOnce(
  server: net.Server,
  port: number,
  host?: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onListening = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };

    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port, host);
  });
}

function isPortInUseError(error: unknown): boolean {
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

function resolveRequestedPort(config: ServerConfig): number {
  const rawPort = config.port ?? DEFAULT_HTTP_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < RANDOM_PORT || port > MAX_PORT) {
    throw new Error(
      `Invalid ${config.protocol} server port: ${JSON.stringify(rawPort)}`,
    );
  }
  return port;
}

function buildCandidatePorts(
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

async function listenServerWithFallback(
  server: net.Server,
  config: ServerConfig,
  allowPortFallback: boolean,
): Promise<number> {
  const requestedPort = resolveRequestedPort(config);
  const candidatePorts = buildCandidatePorts(requestedPort, allowPortFallback);
  let portInUseError: unknown = new Error(
    `Unable to bind ${config.protocol} server on port ${requestedPort}`,
  );

  for (const candidatePort of candidatePorts) {
    try {
      await listenOnce(server, candidatePort, config.host);
      return resolveBoundPort(server, candidatePort);
    } catch (error) {
      if (!isPortInUseError(error)) {
        throw error;
      }
      portInUseError = error;
    }
  }

  throw portInUseError;
}

function logServerStarted(
  config: ServerConfig,
  requestedPort: number,
  boundPort: number,
): void {
  const serverUrl = `${config.protocol}://${config.host ?? DEFAULT_HOST}:${boundPort}`;
  if (boundPort === requestedPort || requestedPort === RANDOM_PORT) {
    Logging.Info(`Server started, listening on ${serverUrl}`);
    return;
  }

  Logging.Info(
    `Port ${requestedPort} in use, listening on ${serverUrl} instead`,
  );
}

export async function listenServer(
  server: net.Server,
  config: ServerConfig,
  allowPortFallback: boolean,
): Promise<void> {
  if (server.listening) {
    return;
  }

  const requestedPort = resolveRequestedPort(config);
  const boundPort = await listenServerWithFallback(
    server,
    config,
    allowPortFallback,
  );
  config.port = boundPort;
  logServerStarted(config, requestedPort, boundPort);
}
