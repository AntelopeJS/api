import sinon from "sinon";
import assert from "node:assert";
import * as http from "node:http";
import { WebSocket } from "ws";
import { HandlerPriority } from "@antelopejs/interface-api";
import * as coreRuntime from "@antelopejs/interface-core/runtime";

import type { Config } from "../server-config";
import { CONNECTION_GRACE_PERIOD_MS } from "../port-listener";
import {
  type RequestContext,
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

const TEST_HOST = "127.0.0.1";
const STREAM_PORT = 25400;
const IN_FLIGHT_PORT = 25410;
const WEBSOCKET_PORT = 25420;
const ROUTE_ROOT = "/stop-connections";
const STREAM_PATH = `${ROUTE_ROOT}/stream`;
const SLOW_PATH = `${ROUTE_ROOT}/slow`;
const SOCKET_PATH = `${ROUTE_ROOT}/socket`;
const PUBLIC_BASE_URL = "https://api.example.com";
const SLOW_RESPONSE_MS = 200;
const SLOW_RESPONSE_BODY = "done";
const STREAM_EVENT = "data: ready\n\n";
const SUCCESS_STATUS = 200;
const STOP_MARGIN_MS = 1000;
const STOP_DEADLINE_MS = CONNECTION_GRACE_PERIOD_MS + STOP_MARGIN_MS;

type RouteMode = "handler" | "websocket";
type RouteCallback = (context: RequestContext) => unknown;

interface CapturedResponse {
  status: number;
  body: string;
}

function stubRuntime(): void {
  sinon
    .stub(coreRuntime, "GetRuntimeInfo")
    .resolves({ dev: false, projectPath: "", env: "test" });
  sinon.stub(coreRuntime, "RegisterDevServer").resolves();
}

function singleServerConfig(port: number): Config {
  return {
    autoListen: false,
    publicBaseUrl: PUBLIC_BASE_URL,
    servers: [{ protocol: "http", host: TEST_HOST, port }],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function serve(port: number): Promise<void> {
  stubRuntime();
  await provide(singleServerConfig(port));
  start();
  await listenServers();
}

async function measureStop(): Promise<number> {
  const startedAt = Date.now();
  await stop();
  return Date.now() - startedAt;
}

function openStream(port: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    http
      .get(
        { host: TEST_HOST, port, path: STREAM_PATH, agent: false },
        (res) => {
          res.once("data", () => resolve(res));
        },
      )
      .once("error", reject);
  });
}

function waitForClose(
  emitter: http.IncomingMessage | WebSocket,
): Promise<void> {
  return new Promise((resolve) => emitter.once("close", () => resolve()));
}

function request(port: number, path: string): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: TEST_HOST, port, path, agent: false }, (res) => {
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

function openWebSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${TEST_HOST}:${port}${SOCKET_PATH}`);
    socket.once("message", () => resolve(socket));
    socket.once("error", reject);
  });
}

describe("Stopping with open connections", () => {
  const registeredIds: string[] = [];
  let originalConfig: Config;

  function register(mode: RouteMode, path: string, callback: RouteCallback) {
    const id = `stop-connections-${registeredIds.length}`;
    registeredIds.push(id);
    registerHandler(id, mode, "get", path, callback, HandlerPriority.NORMAL);
  }

  before(() => {
    originalConfig = getConfig();
  });

  after(() => {
    registeredIds.forEach((id) => unregisterHandler(id));
    if (!originalConfig.servers?.length) {
      return;
    }

    configure(originalConfig);
    start();
  });

  afterEach(async () => {
    await stop();
    sinon.restore();
  });

  it("ends an open event stream within the grace period", async () => {
    register("handler", STREAM_PATH, ({ response }) => {
      response.getWriteStream("text/event-stream").write(STREAM_EVENT);
    });
    await serve(STREAM_PORT);
    const stream = await openStream(STREAM_PORT);
    stream.on("error", () => undefined);
    const streamClosed = waitForClose(stream);

    const stopDuration = await measureStop();

    assert.ok(
      stopDuration < STOP_DEADLINE_MS,
      `Stop took ${stopDuration} ms with an open event stream`,
    );
    await streamClosed;
  });

  it("lets an in-flight request complete", async () => {
    let markReceived: () => void = () => undefined;
    const received = new Promise<void>((resolve) => {
      markReceived = resolve;
    });
    register("handler", SLOW_PATH, async () => {
      markReceived();
      await delay(SLOW_RESPONSE_MS);
      return SLOW_RESPONSE_BODY;
    });
    await serve(IN_FLIGHT_PORT);
    const response = request(IN_FLIGHT_PORT, SLOW_PATH);
    await received;

    const stopping = stop();

    assert.deepEqual(await response, {
      status: SUCCESS_STATUS,
      body: SLOW_RESPONSE_BODY,
    });
    await stopping;
  });

  it("ends an open websocket within the grace period", async () => {
    register("websocket", SOCKET_PATH, (context) => {
      (context.connection as WebSocket).send("connected");
    });
    await serve(WEBSOCKET_PORT);
    const socket = await openWebSocket(WEBSOCKET_PORT);
    const socketClosed = waitForClose(socket);

    const stopDuration = await measureStop();

    assert.ok(
      stopDuration < STOP_DEADLINE_MS,
      `Stop took ${stopDuration} ms with an open websocket`,
    );
    await socketClosed;
  });
});
