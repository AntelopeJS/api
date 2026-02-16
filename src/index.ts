import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import stream from 'stream';

import { ImplementInterface } from '@ajs/core/beta';
import { requestListener, upgradeListener } from './server';
import './middlewares/cors';
import { Logging } from '@ajs/logging/beta';

type ServerProtocol = 'http' | 'https';
type SocketProtocol = 'ws' | 'wss';

interface ServerNetworkConfig {
  host?: string;
  port?: number;
}

interface HTTPConfig extends http.ServerOptions, ServerNetworkConfig {
  protocol: 'http';
}

interface HTTPSConfig extends https.ServerOptions, ServerNetworkConfig {
  protocol: 'https';
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
}

type ServerFactory = (config: ServerConfig) => net.Server;

const DEFAULT_HTTP_PORT = 80;
const DEFAULT_HOST = 'localhost';
const DEFAULT_SERVER_CONFIG: HTTPConfig = { protocol: 'http', port: DEFAULT_HTTP_PORT };

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
  attachServerListeners(server, 'http', 'ws');
  return server;
}

function createHTTPSServer(config: HTTPSConfig): net.Server {
  const server = https.createServer(config);
  attachServerListeners(server, 'https', 'wss');
  return server;
}

function attachServerListeners(server: net.Server, protocol: ServerProtocol, socketProtocol: SocketProtocol): void {
  server.on(
    'request',
    (req: http.IncomingMessage, res: http.ServerResponse) => void requestListener(req, res, protocol),
  );
  server.on(
    'upgrade',
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

function listenServer(server: net.Server, config: ServerConfig): Promise<void> {
  if (server.listening) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const onListening = () => {
      cleanup();
      Logging.Info(`Server started, listening on ${config.protocol}://${config.host ?? DEFAULT_HOST}:${config.port}`);
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      server.off('listening', onListening);
      server.off('error', onError);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(config.port, config.host);
  });
}

export function getConfig(): Config {
  return conf;
}

export async function construct(config: Config): Promise<void> {
  conf = {
    ...config,
    servers: resolveServers(config),
  };

  await ImplementInterface(import('@ajs.local/api/beta'), import('./implementations/api/beta'));
}

export function destroy(): void {}

export function start(): void {
  servers = (conf.servers ?? []).map((serverConfig) => createConfiguredServer(serverConfig));
  listening = false;

  if (conf.autoListen !== false) {
    void listenServers().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      Logging.Info(`Unable to start listening servers: ${message}`);
    });
  }
}

export async function listenServers(): Promise<void> {
  if (listening || servers.length === 0) {
    return;
  }

  await Promise.all((conf.servers ?? []).map((serverConfig, index) => listenServer(servers[index], serverConfig)));
  listening = true;
}

export function stop(): void {
  servers.forEach((server) => server.close());
  servers = [];
  listening = false;
}
