import type * as http from "node:http";
import type * as https from "node:https";

export type ServerProtocol = "http" | "https";
export type SocketProtocol = "ws" | "wss";

interface ServerNetworkConfig {
  host?: string;
  port?: number;
}

export interface HTTPConfig extends http.ServerOptions, ServerNetworkConfig {
  protocol: "http";
}

export interface HTTPSConfig extends https.ServerOptions, ServerNetworkConfig {
  protocol: "https";
}

export type ServerConfig = HTTPConfig | HTTPSConfig;

type AllowedOrigin = string | RegExp | Array<string | RegExp>;

interface CorsConfig {
  allowedOrigins?: AllowedOrigin;
  allowedMethods?: string[];
}

export interface Config {
  servers?: ServerConfig[];
  cors?: CorsConfig;
  autoListen?: boolean;
  strictPort?: boolean;
}

export const DEFAULT_HTTP_PORT = 80;
export const DEFAULT_HOST = "localhost";
export const RANDOM_PORT = 0;

const DEFAULT_SERVER_CONFIG: HTTPConfig = {
  protocol: "http",
  port: DEFAULT_HTTP_PORT,
};

export function resolveServers(config: Config): ServerConfig[] {
  if (config.servers && config.servers.length > 0) {
    return config.servers;
  }

  return [DEFAULT_SERVER_CONFIG];
}
