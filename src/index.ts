import type * as net from "node:net";
import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import type { DevServerEndpoint } from "@antelopejs/interface-core/runtime";
import {
  collectListeningEndpoints,
  registerDevServerEndpoints,
  shouldAllowPortFallback,
} from "./dev-registry";
import { listenServer } from "./port-binding";
import { type Config, resolveServers } from "./server-config";
import { createConfiguredServer } from "./server-factory";
import "./middlewares/cors";

let conf: Config = {
  servers: [],
};

let servers: net.Server[] = [];
let listening = false;

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
        Logging.Error(`Unable to start listening servers: ${message}`);
      });
  }
}

export function getListeningEndpoints(): DevServerEndpoint[] {
  return collectListeningEndpoints(servers, conf.servers);
}

export async function listenServers(): Promise<void> {
  if (listening || servers.length === 0) {
    return;
  }

  listening = true;

  try {
    const allowPortFallback = await shouldAllowPortFallback(conf);
    await Promise.all(
      (conf.servers ?? []).map((serverConfig, index) =>
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
