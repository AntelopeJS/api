import type * as net from "node:net";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  type DevServerEndpoint,
  GetRuntimeInfo,
  RegisterDevServer,
} from "@antelopejs/interface-core/runtime";
import { resolveBoundPort } from "./port-binding";
import {
  type Config,
  DEFAULT_HOST,
  DEFAULT_HTTP_PORT,
  type ServerConfig,
} from "./server-config";

const DEV_SERVER_NAME = "api";

export async function shouldAllowPortFallback(
  config: Config,
): Promise<boolean> {
  if (config.strictPort) {
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

export function collectListeningEndpoints(
  servers: net.Server[],
  configs: ServerConfig[] = [],
): DevServerEndpoint[] {
  return servers
    .map((server, index) => buildEndpoint(server, configs[index]))
    .filter((endpoint): endpoint is DevServerEndpoint => endpoint !== null);
}

export async function registerDevServerEndpoints(
  endpoints: DevServerEndpoint[],
): Promise<void> {
  try {
    await RegisterDevServer(DEV_SERVER_NAME, endpoints);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logging.Warn(`Unable to register dev server endpoints: ${message}`);
  }
}
