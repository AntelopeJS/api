import type * as net from "node:net";
import { Logging } from "@antelopejs/interface-core/logging";
import { ImplementInterface } from "@antelopejs/interface-core";
import type { ConfigVars } from "@antelopejs/interface-core/config";
import type { DevServerEndpoint } from "@antelopejs/interface-core/runtime";

import { resolveDevMode } from "./dev-mode";
import { listenServer } from "./port-binding";
import type { Config } from "./server-config";
import { buildConfigVars } from "./config-vars";
import { createConfiguredServer } from "./server-factory";
import {
  armListenDeadline,
  disarmListenDeadline,
  settlesWithin,
} from "./startup-deadline";
import { configure, getConfig, setCorsConfig } from "./module-config";

export { configure, getConfig, setCorsConfig };
import {
  releaseReservedPorts,
  type ReservedPort,
  reserveServerPorts,
} from "./port-reservation";
import {
  collectListeningEndpoints,
  registerDevServerEndpoints,
  shouldAllowPortFallback,
} from "./dev-registry";
import "./middlewares/cors";

const RESERVATION_RELEASE_TIMEOUT_MS = 1000;
const LISTEN_DEADLINE_MS = 5000;

let servers: net.Server[] = [];
let listening = false;
let reservations: ReservedPort[] = [];

async function releaseReservations(): Promise<void> {
  const pending = reservations;
  reservations = [];
  const isReleased = await settlesWithin(
    releaseReservedPorts(pending),
    RESERVATION_RELEASE_TIMEOUT_MS,
  );
  if (!isReleased) {
    Logging.Warn(
      `Port reservations still closing after ${RESERVATION_RELEASE_TIMEOUT_MS} ms, binding the servers anyway`,
    );
  }
}

function reportMissedListenDeadline(): void {
  Logging.Error(
    `Servers are still not listening ${LISTEN_DEADLINE_MS} ms after start`,
  );
}

async function reserveConfiguredPorts(): Promise<void> {
  await releaseReservations();

  const config = getConfig();
  reservations = await reserveServerPorts(
    config.servers ?? [],
    await shouldAllowPortFallback(config),
  );
}

/**
 * Copies the reserved ports onto the current configuration. Exposed for
 * tests, which reproduce the rebuilt configuration the core may hand to
 * `construct`.
 *
 * `provide` and `construct` receive the configuration through separate
 * substitution passes, so the object `construct` sees may be a rebuilt
 * copy carrying the originally requested ports again. Re-applying the
 * reservation is what keeps the published `API_PORT` and the port
 * `start` binds identical, whatever the core hands over.
 */
export function applyReservedPorts(): void {
  const servers = getConfig().servers ?? [];
  reservations.forEach((reservation, index) => {
    const serverConfig = servers[index];
    if (serverConfig) {
      serverConfig.port = reservation.port;
    }
  });
}

async function publishConfigVars(): Promise<ConfigVars> {
  await reserveConfiguredPorts();

  try {
    return buildConfigVars(getConfig());
  } catch (error) {
    await releaseReservations();
    throw error;
  }
}

/**
 * Publishes the module config variables, before any module constructs.
 *
 * Nothing has constructed at this point, so this path awaits no other
 * module's interface: it only reads the runtime information the core
 * registers before the module lifecycle starts, and holds a socket on
 * the port the server will bind.
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
  disarmListenDeadline();
  return Promise.all(closing).then(() => undefined);
}

export function start(): void {
  const serversClosed = closeServers();
  servers = (getConfig().servers ?? []).map((serverConfig) =>
    createConfiguredServer(serverConfig),
  );

  if (getConfig().autoListen !== false && servers.length > 0) {
    armListenDeadline(LISTEN_DEADLINE_MS, reportMissedListenDeadline);
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
    await releaseReservations();
    await Promise.all(
      (getConfig().servers ?? []).map((serverConfig, index) =>
        listenServer(servers[index], serverConfig, allowPortFallback),
      ),
    );
  } catch (error) {
    listening = false;
    throw error;
  } finally {
    disarmListenDeadline();
  }

  await registerDevServerEndpoints(getListeningEndpoints());
}

export async function stop(): Promise<void> {
  await releaseReservations();
  await closeServers();
}
