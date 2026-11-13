import sinon from "sinon";
import * as net from "node:net";
import assert from "node:assert";

import {
  configure,
  getConfig,
  getListeningEndpoints,
  listenServers,
  start,
  stop,
} from "../index";
import { restoreServersAfterEach, stubRuntime } from "./listen-fixture";

const PORT_IN_USE = { code: "EADDRINUSE" };
const TEST_HOST = "127.0.0.1";
const FALLBACK_BASE_PORT = 25040;
const EXPLICIT_FALSE_PORT = 25060;
const STRICT_FREE_PORT = 25070;
const STRICT_PORT = 25080;
const PROD_PORT = 25090;
const EXHAUSTED_BASE_PORT = 25100;
const EXHAUSTED_RANGE_SIZE = 21;
const MULTI_OCCUPIED_PORT = 25140;
const MULTI_FREE_PORT = 25150;
const RANDOM_PORT = 0;

function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.once("error", reject);
    blocker.listen(port, TEST_HOST, () => resolve(blocker));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function configureSingleServer(port: number, strictPort?: boolean): void {
  configure({
    autoListen: false,
    strictPort,
    servers: [{ protocol: "http", host: TEST_HOST, port }],
  });
  start();
}

const blockers: net.Server[] = [];

async function blockPort(port: number): Promise<void> {
  blockers.push(await occupyPort(port));
}

function fallbackCases(): void {
  it("falls back to the next available port in dev runtime", async () => {
    const registerStub = stubRuntime(true);
    await blockPort(FALLBACK_BASE_PORT);

    configureSingleServer(FALLBACK_BASE_PORT);
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].port, FALLBACK_BASE_PORT + 1);
    assert.equal(getConfig().servers?.[0].port, FALLBACK_BASE_PORT + 1);
    sinon.assert.calledOnce(registerStub);
    assert.deepEqual(registerStub.firstCall.args, ["api", endpoints]);
  });

  it("falls back to a random port when the whole range is occupied", async () => {
    stubRuntime(true);
    const occupiedPorts = Array.from(
      { length: EXHAUSTED_RANGE_SIZE },
      (_, offset) => EXHAUSTED_BASE_PORT + offset,
    );
    await Promise.all(occupiedPorts.map((port) => blockPort(port)));

    configureSingleServer(EXHAUSTED_BASE_PORT);
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.ok(endpoints[0].port > 0);
    assert.ok(!occupiedPorts.includes(endpoints[0].port));
  });

  it("falls back when strictPort is explicitly false in dev runtime", async () => {
    stubRuntime(true);
    await blockPort(EXPLICIT_FALSE_PORT);

    configureSingleServer(EXPLICIT_FALSE_PORT, false);
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].port, EXPLICIT_FALSE_PORT + 1);
  });

  it("rejects when the port is in use and strictPort is enabled", async () => {
    stubRuntime(true);
    await blockPort(STRICT_PORT);

    configureSingleServer(STRICT_PORT, true);

    await assert.rejects(listenServers(), PORT_IN_USE);
  });

  it("binds the requested port when strictPort is enabled and the port is free", async () => {
    stubRuntime(true);

    configureSingleServer(STRICT_FREE_PORT, true);
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].port, STRICT_FREE_PORT);
    assert.equal(getConfig().servers?.[0].port, STRICT_FREE_PORT);
  });

  it("rejects when the port is in use outside of dev runtime", async () => {
    stubRuntime(false);
    await blockPort(PROD_PORT);

    configureSingleServer(PROD_PORT);

    await assert.rejects(listenServers(), PORT_IN_USE);
  });

  it("reports actual endpoints when listening on a random port", async () => {
    stubRuntime(false);

    configureSingleServer(RANDOM_PORT);
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.ok(endpoints[0].port > 0);
    assert.equal(endpoints[0].protocol, "http");
    assert.equal(endpoints[0].host, TEST_HOST);
    assert.equal(getConfig().servers?.[0].port, endpoints[0].port);
  });
}

function portSelectionCases(): void {
  it("binds a single random port when port 0 is requested in dev runtime", async () => {
    stubRuntime(true);

    configureSingleServer(RANDOM_PORT);
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.ok(endpoints[0].port > 0);
    assert.equal(getConfig().servers?.[0].port, endpoints[0].port);
  });

  it("falls back per server when multiple servers are configured", async () => {
    const registerStub = stubRuntime(true);
    await blockPort(MULTI_OCCUPIED_PORT);

    configure({
      autoListen: false,
      servers: [
        { protocol: "http", host: TEST_HOST, port: MULTI_OCCUPIED_PORT },
        { protocol: "http", host: TEST_HOST, port: MULTI_FREE_PORT },
      ],
    });
    start();
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 2);
    assert.equal(endpoints[0].port, MULTI_OCCUPIED_PORT + 1);
    assert.equal(endpoints[1].port, MULTI_FREE_PORT);
    assert.equal(getConfig().servers?.[0].port, MULTI_OCCUPIED_PORT + 1);
    assert.equal(getConfig().servers?.[1].port, MULTI_FREE_PORT);
    sinon.assert.calledOnce(registerStub);
    assert.deepEqual(registerStub.firstCall.args, ["api", endpoints]);
  });

  it("clears endpoints after stop", async () => {
    stubRuntime(false);

    configureSingleServer(RANDOM_PORT);
    await listenServers();
    await stop();

    assert.deepEqual(getListeningEndpoints(), []);
  });
}

describe("Port fallback", () => {
  restoreServersAfterEach();

  afterEach(async () => {
    await Promise.all(blockers.map((blocker) => closeServer(blocker)));
    blockers.length = 0;
  });

  fallbackCases();
  portSelectionCases();
});
