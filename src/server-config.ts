import type * as http from "node:http";
import type * as https from "node:https";
import type { CorsConfig } from "@antelopejs/interface-api";

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

export interface Config {
  servers?: ServerConfig[];
  cors?: CorsConfig;
  autoListen?: boolean;
  strictPort?: boolean;
  publicBaseUrl?: string;
  /**
   * How long, in milliseconds, `stop` and `drain` let served connections
   * finish before they destroy them. In-flight requests complete within
   * it; event streams, websockets and other connections still open when
   * it elapses are destroyed. The core bounds the whole shutdown on its
   * own, 10 s in core 1.24, so a longer value is cut there. Defaults to
   * `DEFAULT_SHUTDOWN_GRACE_PERIOD_MS` for `stop` and to
   * `DEFAULT_DRAIN_GRACE_PERIOD_MS` for `drain`.
   */
  shutdownGracePeriodMs?: number;
}

export const DEFAULT_HTTP_PORT = 80;
export const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 1000;
/** How long the core waits for `drain` before it stops the modules. */
export const DEFAULT_DRAIN_GRACE_PERIOD_MS = 5000;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
export const RANDOM_PORT = 0;

const DEFAULT_SERVER_CONFIG: HTTPConfig = {
  protocol: "http",
  port: DEFAULT_HTTP_PORT,
};

/**
 * The configured grace period within the range a Node timer accepts: Node
 * fires a timer set beyond it, or to a value that is not a number, after
 * 1 ms, which would destroy in-flight requests at once. A numeric string,
 * as config substitution can produce, counts as its number; a missing,
 * blank or non-numeric value gets `defaultMs`.
 */
export function resolveShutdownGracePeriod(
  config: Config,
  defaultMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
): number {
  const configured = config.shutdownGracePeriodMs ?? defaultMs;
  const gracePeriodMs =
    String(configured).trim() === "" ? Number.NaN : Number(configured);
  if (Number.isNaN(gracePeriodMs)) {
    return defaultMs;
  }
  return Math.min(Math.max(gracePeriodMs, 0), MAX_TIMER_DELAY_MS);
}

export function resolveServers(config: Config): ServerConfig[] {
  if (config.servers && config.servers.length > 0) {
    return config.servers;
  }

  return [{ ...DEFAULT_SERVER_CONFIG }];
}
