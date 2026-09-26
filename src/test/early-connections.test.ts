import sinon from "sinon";
import * as net from "node:net";
import * as http from "node:http";
import assert from "node:assert";
import * as coreRuntime from "@antelopejs/interface-core/runtime";

import { setDevMode } from "../dev-mode";
import type { Config } from "../server-config";
import { API_PORT } from "../config-vars";
import {
  configure,
  getConfig,
  getListeningEndpoints,
  listenServers,
  provide,
  start,
  stop,
} from "../index";

const TEST_HOST = "127.0.0.1";
const EARLY_REQUEST_PORT = 25300;
const SILENT_CLIENT_PORT = 25310;
const RESTART_PORT = 25320;
const REPLACED_SERVER_PORT = 25330;
const KEEP_ALIVE_PORT = 25340;
const RANDOM_PORT = 0;
const PUBLIC_BASE_URL = "https://api.example.com";
const UNSERVED_WINDOW_MS = 100;
const DEADLINE_MS = 1500;
const SERVICE_UNAVAILABLE_STATUS = 503;

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

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, TEST_HOST, () => resolve(socket));
    socket.once("error", reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms).unref();
  });
}

function withinDeadline<T>(task: Promise<T>, message: string): Promise<T> {
  return Promise.race([task, rejectAfter(DEADLINE_MS, message)]);
}

function requestStatus(
  port: number,
  agent: http.Agent | false = false,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: TEST_HOST, port, path: "/health", agent }, (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode));
      })
      .once("error", reject);
  });
}

async function startServing(): Promise<void> {
  start();
  await withinDeadline(listenServers(), "The server never started serving");
}

async function isSettledWithin(
  task: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let isSettled = false;
  const markSettled = () => {
    isSettled = true;
  };
  task.then(markSettled, markSettled);
  await delay(ms);
  return isSettled;
}

describe("Connections accepted before the server starts", () => {
  const openSockets: net.Socket[] = [];
  let originalConfig: Config;

  before(() => {
    originalConfig = getConfig();
  });

  after(() => {
    if (!originalConfig.servers?.length) {
      return;
    }

    configure(originalConfig);
    start();
  });

  afterEach(async () => {
    openSockets.forEach((socket) => socket.destroy());
    openSockets.length = 0;
    await stop();
    sinon.restore();
    setDevMode(false);
  });

  it("answers a request sent during init once the server starts", async () => {
    stubRuntime();
    await provide(singleServerConfig(EARLY_REQUEST_PORT));

    const earlyStatus = requestStatus(EARLY_REQUEST_PORT);
    assert.equal(await isSettledWithin(earlyStatus, UNSERVED_WINDOW_MS), false);

    await startServing();

    const status = await withinDeadline(
      earlyStatus,
      "The early request was never answered",
    );
    assert.notEqual(status, SERVICE_UNAVAILABLE_STATUS);
    assert.equal(status, await requestStatus(EARLY_REQUEST_PORT));
  });

  it("starts while a silent client holds a connection", async () => {
    stubRuntime();
    await provide(singleServerConfig(SILENT_CLIENT_PORT));

    const silentSocket = await connect(SILENT_CLIENT_PORT);
    silentSocket.on("error", () => undefined);
    openSockets.push(silentSocket);

    await startServing();

    assert.equal(getListeningEndpoints()[0].port, SILENT_CLIENT_PORT);
    assert.ok(await requestStatus(SILENT_CLIENT_PORT));
  });

  it("publishes and serves the port bound for port 0", async () => {
    stubRuntime();
    const vars = await provide(singleServerConfig(RANDOM_PORT));
    assert.ok(Number(vars[API_PORT]) > 0);

    await startServing();

    assert.equal(getListeningEndpoints()[0].port, vars[API_PORT]);
    assert.ok(await requestStatus(Number(vars[API_PORT])));
  });

  it("binds the port again when starting after a stop", async () => {
    stubRuntime();
    await provide(singleServerConfig(RESTART_PORT));
    await startServing();
    await stop();

    assert.deepEqual(getListeningEndpoints(), []);
    await assert.rejects(requestStatus(RESTART_PORT));

    await startServing();

    assert.equal(getListeningEndpoints()[0].port, RESTART_PORT);
    assert.ok(await requestStatus(RESTART_PORT));
  });

  it("hands the bound port to the new servers when started twice", async () => {
    stubRuntime();
    await provide(singleServerConfig(REPLACED_SERVER_PORT));
    await startServing();
    await startServing();

    assert.equal(getListeningEndpoints()[0].port, REPLACED_SERVER_PORT);
    assert.ok(await requestStatus(REPLACED_SERVER_PORT));
  });

  it("closes idle keep-alive connections on stop", async () => {
    stubRuntime();
    const agent = new http.Agent({ keepAlive: true });
    await provide(singleServerConfig(KEEP_ALIVE_PORT));
    await startServing();
    await requestStatus(KEEP_ALIVE_PORT, agent);

    await withinDeadline(stop(), "Stop waited on an idle connection");
    agent.destroy();
  });
});
