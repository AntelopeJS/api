import sinon from "sinon";
import * as net from "node:net";
import * as http from "node:http";
import assert from "node:assert";
import { Logging } from "@antelopejs/interface-core/logging";
import * as coreRuntime from "@antelopejs/interface-core/runtime";

import { setDevMode } from "../dev-mode";
import type { Config } from "../server-config";
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
const PROBED_RESERVATION_PORT = 25300;
const SILENT_RESERVATION_PORT = 25310;
const STUCK_RESERVATION_PORT = 25320;
const UNLISTENED_PORT = 25330;
const STUCK_RELEASE_TEST_TIMEOUT_MS = 4000;
const START_LISTEN_DEADLINE_MS = 5000;
const PUBLIC_BASE_URL = "https://api.example.com";
const LISTEN_DEADLINE_MS = 1500;
const SERVICE_UNAVAILABLE_STATUS = 503;
const PROBE_REQUEST = `GET /health HTTP/1.1\r\nHost: ${TEST_HOST}\r\n\r\n`;

interface ProbeResult {
  socket: net.Socket;
  response: Promise<string>;
}

function stubRuntime(): void {
  sinon
    .stub(coreRuntime, "GetRuntimeInfo")
    .resolves({ dev: false, projectPath: "", env: "test" });
  sinon.stub(coreRuntime, "RegisterDevServer").resolves();
}

function stubCloseNeverCallingBack(): sinon.SinonStub {
  const closeStub = sinon.stub(net.Server.prototype, "close");
  return closeStub.callsFake(function (this: net.Server) {
    return closeStub.wrappedMethod.call(this);
  });
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

function collectResponse(socket: net.Socket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", () => undefined);
    socket.once("close", () => resolve(Buffer.concat(chunks).toString()));
  });
}

async function probeWithRequest(port: number): Promise<ProbeResult> {
  const socket = await connect(port);
  const response = collectResponse(socket);
  socket.end(PROBE_REQUEST);
  return { socket, response };
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms).unref();
  });
}

function listenWithinDeadline(): Promise<void> {
  return Promise.race([
    listenServers(),
    rejectAfter(LISTEN_DEADLINE_MS, "The real server never started listening"),
  ]);
}

function requestStatus(port: number): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: TEST_HOST, port, path: "/health", agent: false }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .once("error", reject);
  });
}

describe("Connections accepted during the port reservation", () => {
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

  it("starts the real server after a probe hit the reservation", async () => {
    stubRuntime();
    await provide(singleServerConfig(PROBED_RESERVATION_PORT));

    const probe = await probeWithRequest(PROBED_RESERVATION_PORT);
    openSockets.push(probe.socket);

    start();
    await listenWithinDeadline();

    const reservationResponse = await probe.response;
    assert.match(
      reservationResponse,
      new RegExp(`^HTTP/1\\.1 ${SERVICE_UNAVAILABLE_STATUS} `),
    );
    assert.equal(getListeningEndpoints()[0].port, PROBED_RESERVATION_PORT);
    assert.ok(await requestStatus(PROBED_RESERVATION_PORT));
  });

  it("starts the real server while a silent client holds a connection", async () => {
    stubRuntime();
    await provide(singleServerConfig(SILENT_RESERVATION_PORT));

    const silentSocket = await connect(SILENT_RESERVATION_PORT);
    silentSocket.on("error", () => undefined);
    openSockets.push(silentSocket);

    start();
    await listenWithinDeadline();

    assert.equal(getListeningEndpoints()[0].port, SILENT_RESERVATION_PORT);
    assert.ok(await requestStatus(SILENT_RESERVATION_PORT));
  });

  it("binds the servers even when a reservation never finishes closing", async function () {
    this.timeout(STUCK_RELEASE_TEST_TIMEOUT_MS);
    stubRuntime();
    const warnStub = sinon.stub(Logging, "Warn");
    await provide(singleServerConfig(STUCK_RESERVATION_PORT));

    const closeStub = stubCloseNeverCallingBack();
    start();
    await listenServers();
    closeStub.restore();

    sinon.assert.calledOnce(warnStub);
    assert.equal(getListeningEndpoints()[0].port, STUCK_RESERVATION_PORT);
    assert.ok(await requestStatus(STUCK_RESERVATION_PORT));
  });

  it("logs an error when the servers miss the listen deadline", () => {
    sinon
      .stub(coreRuntime, "GetRuntimeInfo")
      .returns(new Promise(() => undefined));
    const errorStub = sinon.stub(Logging, "Error");
    const clock = sinon.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });

    configure({
      publicBaseUrl: PUBLIC_BASE_URL,
      servers: [{ protocol: "http", host: TEST_HOST, port: UNLISTENED_PORT }],
    });
    start();
    clock.tick(START_LISTEN_DEADLINE_MS);

    sinon.assert.calledOnce(errorStub);
  });
});
