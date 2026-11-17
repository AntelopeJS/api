import sinon from "sinon";
import * as http from "node:http";
import { HandlerPriority } from "@antelopejs/interface-api";
import * as coreRuntime from "@antelopejs/interface-core/runtime";

import type { Config } from "../server-config";
import {
  type RouteCallback,
  registerHandler,
  unregisterHandler,
} from "../server";
import {
  configure,
  getConfig,
  listenServers,
  provide,
  start,
  stop,
} from "../index";

export const TEST_HOST = "127.0.0.1";
export const ROUTE_ROOT = "/stop-connections";
const PUBLIC_BASE_URL = "https://api.example.com";
export const SLOW_RESPONSE_MS = 200;
export const LONG_RESPONSE_MS = 1500;
export const LONG_GRACE_PERIOD_MS = 3000;
export const SLOW_RESPONSE_BODY = "done";
export const SUCCESS_STATUS = 200;

type RouteMode = "handler" | "websocket";

export interface CapturedResponse {
  status: number;
  body: string;
}

/** The requests the routes of the current test have started to handle. */
export const handledRequests = { count: 0 };

function stubRuntime(): void {
  sinon
    .stub(coreRuntime, "GetRuntimeInfo")
    .resolves({ dev: false, projectPath: "", env: "test" });
  sinon.stub(coreRuntime, "RegisterDevServer").resolves();
}

function singleServerConfig(
  port: number,
  shutdownGracePeriodMs?: number,
): Config {
  return {
    autoListen: false,
    shutdownGracePeriodMs,
    publicBaseUrl: PUBLIC_BASE_URL,
    servers: [{ protocol: "http", host: TEST_HOST, port }],
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serves one http server on `port` through the module's lifecycle. */
export async function serve(
  port: number,
  shutdownGracePeriodMs?: number,
): Promise<void> {
  stubRuntime();
  await provide(singleServerConfig(port, shutdownGracePeriodMs));
  start();
  await listenServers();
}

/** Sends a GET and resolves with its status and body once it ends. */
export function request(
  port: number,
  path: string,
  agent: http.Agent | false = false,
): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: TEST_HOST, port, path, agent }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.once("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      })
      .once("error", reject);
  });
}

const registeredIds: string[] = [];

/** Registers a GET route that `restoreServerAfterEach` removes. */
export function register(
  mode: RouteMode,
  path: string,
  callback: RouteCallback,
) {
  const id = `stop-connections-${registeredIds.length}`;
  registeredIds.push(id);
  registerHandler(
    id,
    {
      mode: mode,
      method: "get",
      location: path,
      priority: HandlerPriority.NORMAL,
    },
    callback,
  );
}

/**
 * Registers a route answering after `durationMs`; the promise resolves once
 * `requestCount` requests are being handled.
 */
export function registerSlowRoute(
  path: string,
  durationMs: number,
  requestCount = 1,
) {
  let handled = 0;
  let markReceived: () => void = () => undefined;
  const received = new Promise<void>((resolve) => {
    markReceived = resolve;
  });
  register("handler", path, async () => {
    handled += 1;
    handledRequests.count += 1;
    if (handled === requestCount) {
      markReceived();
    }
    await delay(durationMs);
    return SLOW_RESPONSE_BODY;
  });
  return received;
}

/**
 * Stops the server after each test, then restores the configuration the
 * test project started with.
 */
export function restoreServerAfterEach(): void {
  let originalConfig: Config;

  before(() => {
    originalConfig = getConfig();
  });

  after(() => {
    registeredIds.splice(0).forEach((id) => unregisterHandler(id));
    if (!originalConfig.servers?.length) {
      return;
    }

    configure(originalConfig);
    start();
  });

  afterEach(async () => {
    await stop();
    sinon.restore();
    handledRequests.count = 0;
  });
}
