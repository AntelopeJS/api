import type * as net from "node:net";
import { Logging } from "@antelopejs/interface-core/logging";
import { ImplementInterface } from "@antelopejs/interface-core";
import type { ConfigVars } from "@antelopejs/interface-core/config";
import type { DevServerEndpoint } from "@antelopejs/interface-core/runtime";

import { resolveDevMode } from "./dev-mode";
import { logServerStarted } from "./port-binding";
import type { Config } from "./server-config";
import { buildConfigVars } from "./config-vars";
import { createConfiguredServer } from "./server-factory";
import { configure, getConfig, setCorsConfig } from "./module-config";

export { configure, getConfig, setCorsConfig };
import {
  type BoundListener,
  bindServerPorts,
  closeListeners,
  isBoundFor,
} from "./port-listener";
import {
  collectListeningEndpoints,
  registerDevServerEndpoints,
  shouldAllowPortFallback,
} from "./dev-registry";
import "./middlewares/cors";

let servers: net.Server[] = [];
let listening = false;
let listeners: BoundListener[] = [];

function releaseListeners(): Promise<void> {
  const pending = listeners;
  listeners = [];
  return closeListeners(pending);
}

async function bindConfiguredPorts(): Promise<void> {
  await releaseListeners();

  const config = getConfig();
  listeners = await bindServerPorts(
    config.servers ?? [],
    await shouldAllowPortFallback(config),
  );
}

/**
 * Copies the bound ports onto the current configuration. Exposed for
 * tests, which reproduce the rebuilt configuration the core may hand to
 * `construct`.
 *
 * `provide` and `construct` receive the configuration through separate
 * substitution passes, so the object `construct` sees may be a rebuilt
 * copy carrying the originally requested ports again. Re-applying the
 * bound ports is what keeps the published `API_PORT` and the port the
 * module reports and logs identical, whatever the core hands over.
 */
export function applyReservedPorts(): void {
  const servers = getConfig().servers ?? [];
  listeners.forEach((listener, index) => {
    const serverConfig = servers[index];
    if (serverConfig) {
      serverConfig.port = listener.port;
    }
  });
}

async function publishConfigVars(): Promise<ConfigVars> {
  await bindConfiguredPorts();

  try {
    return buildConfigVars(getConfig());
  } catch (error) {
    await releaseListeners();
    throw error;
  }
}

/**
 * Publishes the module config variables, before any module constructs.
 *
 * Nothing has constructed at this point, so this path awaits no other
 * module's interface: it only reads the runtime information the core
 * registers before the module lifecycle starts, and binds the listening
 * socket the server is served from once it starts.
 */
export async function provide(config: Config): Promise<ConfigVars> {
  configure(config);
  await resolveDevMode();

  return publishConfigVars();
}

export async function construct(config: Config): Promise<void> {
  configure(config);
  applyReservedPorts();
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

/**
 * Creates the configured servers and, unless `autoListen` is `false`,
 * serves them from the listening sockets. Calling it again replaces the
 * servers: the sockets stay bound and hand their connections to the new
 * ones.
 */
export function start(): void {
  void closeServers();
  servers = (getConfig().servers ?? []).map((serverConfig) =>
    createConfiguredServer(serverConfig),
  );

  if (getConfig().autoListen !== false) {
    listenServers().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      Logging.Error(`Unable to start listening servers: ${message}`);
    });
  }
}

export function getListeningEndpoints(): DevServerEndpoint[] {
  if (!listening) {
    return [];
  }

  return collectListeningEndpoints(
    listeners.map((listener) => listener.socket),
    getConfig().servers,
  );
}

async function ensureListeners(): Promise<void> {
  if (isBoundFor(listeners, getConfig().servers ?? [])) {
    return;
  }

  await bindConfiguredPorts();
}

function serveListeners(): void {
  const configs = getConfig().servers ?? [];
  listeners.forEach((listener, index) => {
    listener.serve(servers[index]);
    logServerStarted(configs[index], listener.requestedPort, listener.port);
  });
}

/**
 * Serves the created servers from their listening sockets. The sockets
 * bound during `provide` are kept when the configuration still names
 * their address; otherwise — after a `stop`, when `provide` never ran, or
 * when the configuration changed — they are bound again.
 */
export async function listenServers(): Promise<void> {
  if (listening || servers.length === 0) {
    return;
  }

  listening = true;

  try {
    await ensureListeners();
  } catch (error) {
    listening = false;
    throw error;
  }

  serveListeners();
  await registerDevServerEndpoints(getListeningEndpoints());
}

export async function stop(): Promise<void> {
  await Promise.all([closeServers(), releaseListeners()]);
}
