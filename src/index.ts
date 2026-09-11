import type * as net from "node:net";
import { Logging } from "@antelopejs/interface-core/logging";
import { ImplementInterface } from "@antelopejs/interface-core";
import type { DevServerEndpoint } from "@antelopejs/interface-core/runtime";

import { resolveDevMode } from "./dev-mode";
import { listenServer } from "./port-binding";
import type { Config } from "./server-config";
import { createConfiguredServer } from "./server-factory";
import { configure, getConfig, setCorsConfig } from "./module-config";

export { configure, getConfig, setCorsConfig };
import {
  collectListeningEndpoints,
  registerDevServerEndpoints,
  shouldAllowPortFallback,
} from "./dev-registry";
import "./middlewares/cors";

let servers: net.Server[] = [];
let listening = false;

export async function construct(config: Config): Promise<void> {
  configure(config);
  await resolveDevMode();

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
  servers = (getConfig().servers ?? []).map((serverConfig) =>
    createConfiguredServer(serverConfig),
  );

  if (getConfig().autoListen !== false) {
    void serversClosed
      .then(() => listenServers())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        Logging.Error(`Unable to start listening servers: ${message}`);
      });
  }
}

export function getListeningEndpoints(): DevServerEndpoint[] {
  return collectListeningEndpoints(servers, getConfig().servers);
}

export async function listenServers(): Promise<void> {
  if (listening || servers.length === 0) {
    return;
  }

  listening = true;

  try {
    const allowPortFallback = await shouldAllowPortFallback(getConfig());
    await Promise.all(
      (getConfig().servers ?? []).map((serverConfig, index) =>
        listenServer(servers[index], serverConfig, allowPortFallback),
      ),
    );
  } catch (error) {
    listening = false;
    throw error;
  }

  await registerDevServerEndpoints(getListeningEndpoints());
}

export function stop(): Promise<void> {
  return closeServers();
}
