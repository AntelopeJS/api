import * as http from "node:http";
import * as https from "node:https";
import type * as net from "node:net";
import type stream from "node:stream";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  type DevServerEndpoint,
  GetRuntimeInfo,
  RegisterDevServer,
} from "@antelopejs/interface-core/runtime";
import { requestListener, upgradeListener } from "./server";
import "./middlewares/cors";
import { Logging } from "@antelopejs/interface-core/logging";

type ServerProtocol = "http" | "https";
type SocketProtocol = "ws" | "wss";

interface ServerNetworkConfig {
  host?: string;
  port?: number;
}

interface HTTPConfig extends http.ServerOptions, ServerNetworkConfig {
  protocol: "http";
}

interface HTTPSConfig extends https.ServerOptions, ServerNetworkConfig {
  protocol: "https";
}

type ServerConfig = HTTPConfig | HTTPSConfig;

type AllowedOrigin = string | RegExp | Array<string | RegExp>;

interface CorsConfig {
  allowedOrigins?: AllowedOrigin;
  allowedMethods?: string[];
}

interface Config {
  servers?: ServerConfig[];
  cors?: CorsConfig;
  autoListen?: boolean;
  strictPort?: boolean;
}

type ServerFactory = (config: ServerConfig) => net.Server;

const DEFAULT_HTTP_PORT = 80;
const DEFAULT_HOST = "localhost";
const MAX_PORT_FALLBACK_OFFSET = 20;
const RANDOM_PORT = 0;
const DEV_SERVER_NAME = "api";
const DEFAULT_SERVER_CONFIG: HTTPConfig = {
  protocol: "http",
  port: DEFAULT_HTTP_PORT,
};

const SERVER_FACTORY_BY_PROTOCOL: Record<ServerProtocol, ServerFactory> = {
  http: (config) => createHTTPServer(config as HTTPConfig),
  https: (config) => createHTTPSServer(config as HTTPSConfig),
};

let conf: Config = {
  servers: [],
};

let servers: net.Server[] = [];
let listening = false;

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

function resolveServers(config: Config): ServerConfig[] {
  if (config.servers && config.servers.length > 0) {
    return config.servers;
  }

  return [DEFAULT_SERVER_CONFIG];
}

function createConfiguredServer(config: ServerConfig): net.Server {
  const serverFactory = SERVER_FACTORY_BY_PROTOCOL[config.protocol];
  return serverFactory(config);
}

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

function resolveBoundPort(server: net.Server, fallbackPort: number): number {
  const address = server.address();
  if (address && typeof address === "object") {
    return address.port;
  }

  return fallbackPort;
}

function buildCandidatePorts(
  requestedPort: number,
  allowPortFallback: boolean,
): number[] {
  if (!allowPortFallback) {
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
  const requestedPort = config.port ?? DEFAULT_HTTP_PORT;
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

async function listenServer(
  server: net.Server,
  config: ServerConfig,
  allowPortFallback: boolean,
): Promise<void> {
  if (server.listening) {
    return;
  }

  const requestedPort = config.port ?? DEFAULT_HTTP_PORT;
  const boundPort = await listenServerWithFallback(
    server,
    config,
    allowPortFallback,
  );
  config.port = boundPort;
  logServerStarted(config, requestedPort, boundPort);
}

export function getConfig(): Config {
  return conf;
}

export function configure(config: Config): void {
  conf = {
    ...config,
    servers: resolveServers(config),
  };
}

export async function construct(config: Config): Promise<void> {
  configure(config);

  void ImplementInterface(
    await import("@antelopejs/interface-api"),
    await import("./implementations/api"),
  );
}

export function destroy(): void {}

function closeServers(): Promise<void> {
  const closing = servers.map(
    (server) =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  servers = [];
  listening = false;
  return Promise.all(closing).then(() => undefined);
}

export function start(): void {
  const serversClosed = closeServers();
  servers = (conf.servers ?? []).map((serverConfig) =>
    createConfiguredServer(serverConfig),
  );

  if (conf.autoListen !== false) {
    void serversClosed
      .then(() => listenServers())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        Logging.Info(`Unable to start listening servers: ${message}`);
      });
  }
}

async function shouldAllowPortFallback(): Promise<boolean> {
  if (conf.strictPort) {
    return false;
  }

  const runtimeInfo = await GetRuntimeInfo();
  return runtimeInfo.dev;
}

function buildEndpoint(
  server: net.Server,
  config?: ServerConfig,
): DevServerEndpoint | null {
  if (!config || !server.listening) {
    return null;
  }

  const port = resolveBoundPort(server, config.port ?? DEFAULT_HTTP_PORT);
  return {
    protocol: config.protocol,
    host: config.host ?? DEFAULT_HOST,
    port,
  };
}

export function getListeningEndpoints(): DevServerEndpoint[] {
  return servers
    .map((server, index) => buildEndpoint(server, conf.servers?.[index]))
    .filter((endpoint): endpoint is DevServerEndpoint => endpoint !== null);
}

async function registerDevServerEndpoints(): Promise<void> {
  try {
    await RegisterDevServer(DEV_SERVER_NAME, getListeningEndpoints());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logging.Warn(`Unable to register dev server endpoints: ${message}`);
  }
}

export async function listenServers(): Promise<void> {
  if (listening || servers.length === 0) {
    return;
  }

  listening = true;

  try {
    const allowPortFallback = await shouldAllowPortFallback();
    await Promise.all(
      (conf.servers ?? []).map((serverConfig, index) =>
        listenServer(servers[index], serverConfig, allowPortFallback),
      ),
    );
  } catch (error) {
    listening = false;
    throw error;
  }

  await registerDevServerEndpoints();
}

export function stop(): Promise<void> {
  return closeServers();
}
