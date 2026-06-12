import assert from "node:assert";
import * as net from "node:net";
import sinon from "sinon";
import {
  configure,
  getConfig,
  getListeningEndpoints,
  listenServers,
  start,
  stop,
} from "../index";
import * as runtime from "../runtime";

const TEST_HOST = "127.0.0.1";
const FALLBACK_BASE_PORT = 25040;
const STRICT_PORT = 25080;
const PROD_PORT = 25090;
const EXHAUSTED_BASE_PORT = 25100;
const EXHAUSTED_RANGE_SIZE = 21;
const RANDOM_PORT = 0;

interface PortInUseError {
  code?: string;
}

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

function isPortInUseError(error: unknown): boolean {
  return (error as PortInUseError).code === "EADDRINUSE";
}

const LISTEN_POLL_INTERVAL_MS = 50;
const LISTEN_POLL_TIMEOUT_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForListening(): Promise<void> {
  const deadline = Date.now() + LISTEN_POLL_TIMEOUT_MS;
  while (getListeningEndpoints().length === 0) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for servers to listen");
    }
    await delay(LISTEN_POLL_INTERVAL_MS);
  }
}

describe("Port fallback", () => {
  const blockers: net.Server[] = [];
  let originalConfig: ReturnType<typeof getConfig>;

  async function blockPort(port: number): Promise<void> {
    blockers.push(await occupyPort(port));
  }

  before(() => {
    originalConfig = getConfig();
  });

  after(async () => {
    if (!originalConfig.servers?.length) {
      return;
    }

    configure(originalConfig);
    start();
    if (originalConfig.autoListen !== false) {
      await waitForListening();
    }
  });

  afterEach(async () => {
    await stop();
    sinon.restore();
    await Promise.all(blockers.map((blocker) => closeServer(blocker)));
    blockers.length = 0;
  });

  it("falls back to the next available port in dev runtime", async () => {
    sinon.stub(runtime, "isDevRuntime").resolves(true);
    const registerStub = sinon.stub(runtime, "registerDevServer").resolves();
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
    sinon.stub(runtime, "isDevRuntime").resolves(true);
    sinon.stub(runtime, "registerDevServer").resolves();
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

  it("rejects when the port is in use and strictPort is enabled", async () => {
    sinon.stub(runtime, "isDevRuntime").resolves(true);
    await blockPort(STRICT_PORT);

    configureSingleServer(STRICT_PORT, true);

    await assert.rejects(listenServers(), isPortInUseError);
  });

  it("rejects when the port is in use outside of dev runtime", async () => {
    sinon.stub(runtime, "isDevRuntime").resolves(false);
    await blockPort(PROD_PORT);

    configureSingleServer(PROD_PORT);

    await assert.rejects(listenServers(), isPortInUseError);
  });

  it("reports actual endpoints when listening on a random port", async () => {
    sinon.stub(runtime, "isDevRuntime").resolves(false);
    sinon.stub(runtime, "registerDevServer").resolves();

    configureSingleServer(RANDOM_PORT);
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.ok(endpoints[0].port > 0);
    assert.equal(endpoints[0].protocol, "http");
    assert.equal(endpoints[0].host, TEST_HOST);
    assert.equal(getConfig().servers?.[0].port, endpoints[0].port);
  });

  it("clears endpoints after stop", async () => {
    sinon.stub(runtime, "isDevRuntime").resolves(false);
    sinon.stub(runtime, "registerDevServer").resolves();

    configureSingleServer(RANDOM_PORT);
    await listenServers();
    await stop();

    assert.deepEqual(getListeningEndpoints(), []);
  });
});
