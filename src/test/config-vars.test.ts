import sinon from "sinon";
import * as net from "node:net";
import assert from "node:assert";
import * as coreRuntime from "@antelopejs/interface-core/runtime";
import type { ConfigVars } from "@antelopejs/interface-core/config";

import { setDevMode } from "../dev-mode";
import type { Config } from "../server-config";
import {
  PortReservationError,
  releaseReservedPorts,
  type ReservedPort,
  reserveServerPorts,
} from "../port-reservation";
import {
  configure,
  getConfig,
  getListeningEndpoints,
  listenServers,
  publishConfigVars,
  start,
  stop,
} from "../index";
import {
  API_LOCAL_BASE_URL,
  API_PORT,
  API_PUBLIC_BASE_URL,
  buildConfigVars,
  MissingPublicBaseUrlError,
} from "../config-vars";

const TEST_HOST = "127.0.0.1";
const RESERVED_FREE_PORT = 25200;
const RESERVED_TAKEN_PORT = 25210;
const RESERVED_STRICT_PORT = 25220;
const CONSTRUCT_FREE_PORT = 25230;
const CONSTRUCT_TAKEN_PORT = 25240;
const CONSTRUCT_STRICT_PORT = 25250;
const SECONDARY_PORT = 25260;
const RANDOM_PORT = 0;
const PUBLIC_BASE_URL = "https://api.example.com";

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

function stubRuntime(dev: boolean): void {
  sinon
    .stub(coreRuntime, "GetRuntimeInfo")
    .resolves({ dev, projectPath: "", env: "test" });
  sinon.stub(coreRuntime, "RegisterDevServer").resolves();
  setDevMode(dev);
}

function publish(config: Config): Promise<ConfigVars> {
  configure(config);
  return publishConfigVars();
}

function singleServerConfig(port: number, host = TEST_HOST): Config {
  return {
    autoListen: false,
    publicBaseUrl: PUBLIC_BASE_URL,
    servers: [{ protocol: "http", host, port }],
  };
}

describe("Published config variables", () => {
  afterEach(() => {
    sinon.restore();
    setDevMode(false);
  });

  it("derives every variable from the first configured server", () => {
    const vars = buildConfigVars({
      publicBaseUrl: PUBLIC_BASE_URL,
      servers: [
        { protocol: "http", host: TEST_HOST, port: RESERVED_FREE_PORT },
        { protocol: "http", host: TEST_HOST, port: SECONDARY_PORT },
      ],
    });

    assert.equal(vars[API_PORT], RESERVED_FREE_PORT);
    assert.equal(
      vars[API_LOCAL_BASE_URL],
      `http://${TEST_HOST}:${RESERVED_FREE_PORT}`,
    );
    assert.equal(vars[API_PUBLIC_BASE_URL], PUBLIC_BASE_URL);
  });

  it("keeps the local base url on loopback for a wildcard host", () => {
    const wildcardHosts = ["0.0.0.0", "::", "[::]"];

    for (const host of wildcardHosts) {
      const vars = buildConfigVars({
        publicBaseUrl: PUBLIC_BASE_URL,
        servers: [{ protocol: "http", host, port: RESERVED_FREE_PORT }],
      });

      assert.equal(
        vars[API_LOCAL_BASE_URL],
        `http://${TEST_HOST}:${RESERVED_FREE_PORT}`,
      );
    }
  });

  it("defaults the public base url to the local one in development", () => {
    setDevMode(true);

    const vars = buildConfigVars({
      servers: [
        { protocol: "http", host: TEST_HOST, port: RESERVED_FREE_PORT },
      ],
    });

    assert.equal(vars[API_PUBLIC_BASE_URL], vars[API_LOCAL_BASE_URL]);
  });

  it("rejects a missing public base url outside of development", () => {
    setDevMode(false);

    assert.throws(
      () =>
        buildConfigVars({
          servers: [
            { protocol: "http", host: TEST_HOST, port: RESERVED_FREE_PORT },
          ],
        }),
      (error: unknown) =>
        error instanceof MissingPublicBaseUrlError &&
        error.message.includes("publicBaseUrl"),
    );
  });

  it("strips trailing slashes from the configured public base url", () => {
    const vars = buildConfigVars({
      publicBaseUrl: `${PUBLIC_BASE_URL}//`,
      servers: [
        { protocol: "http", host: TEST_HOST, port: RESERVED_FREE_PORT },
      ],
    });

    assert.equal(vars[API_PUBLIC_BASE_URL], PUBLIC_BASE_URL);
  });
});

describe("Port reservation", () => {
  const blockers: net.Server[] = [];
  let reservations: ReservedPort[] = [];

  async function blockPort(port: number): Promise<void> {
    blockers.push(await occupyPort(port));
  }

  afterEach(async () => {
    await releaseReservedPorts(reservations);
    reservations = [];
    await Promise.all(blockers.map((blocker) => closeServer(blocker)));
    blockers.length = 0;
  });

  it("reserves the requested port and writes it back to the config", async () => {
    const servers = singleServerConfig(RESERVED_FREE_PORT).servers ?? [];

    reservations = await reserveServerPorts(servers, false);

    assert.equal(reservations[0].port, RESERVED_FREE_PORT);
    assert.equal(servers[0].port, RESERVED_FREE_PORT);
  });

  it("reserves the next free port when fallback is allowed", async () => {
    await blockPort(RESERVED_TAKEN_PORT);
    const servers = singleServerConfig(RESERVED_TAKEN_PORT).servers ?? [];

    reservations = await reserveServerPorts(servers, true);

    assert.equal(reservations[0].port, RESERVED_TAKEN_PORT + 1);
    assert.equal(servers[0].port, RESERVED_TAKEN_PORT + 1);
  });

  it("fails with a named error when fallback is not allowed", async () => {
    await blockPort(RESERVED_STRICT_PORT);
    const servers = singleServerConfig(RESERVED_STRICT_PORT).servers ?? [];

    await assert.rejects(
      reserveServerPorts(servers, false),
      (error: unknown) =>
        error instanceof PortReservationError &&
        error.name === "PortReservationError" &&
        error.message.includes(String(RESERVED_STRICT_PORT)),
    );
  });

  it("reserves an operating system assigned port for port 0", async () => {
    const servers = singleServerConfig(RANDOM_PORT).servers ?? [];

    reservations = await reserveServerPorts(servers, false);

    assert.ok(reservations[0].port > 0);
    assert.equal(servers[0].port, reservations[0].port);
  });

  it("releases every reservation when one of them fails", async () => {
    await blockPort(RESERVED_STRICT_PORT);

    await assert.rejects(
      reserveServerPorts(
        [
          { protocol: "http", host: TEST_HOST, port: SECONDARY_PORT },
          { protocol: "http", host: TEST_HOST, port: RESERVED_STRICT_PORT },
        ],
        false,
      ),
      PortReservationError,
    );

    const probe = await occupyPort(SECONDARY_PORT);
    await closeServer(probe);
  });
});

describe("Config variables publication", () => {
  const blockers: net.Server[] = [];
  let originalConfig: Config;

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
  });

  afterEach(async () => {
    await stop();
    sinon.restore();
    setDevMode(false);
    await Promise.all(blockers.map((blocker) => closeServer(blocker)));
    blockers.length = 0;
  });

  it("publishes the three variables for a free port", async () => {
    stubRuntime(false);

    const vars = await publish(singleServerConfig(CONSTRUCT_FREE_PORT));

    assert.equal(vars[API_PORT], CONSTRUCT_FREE_PORT);
    assert.equal(
      vars[API_LOCAL_BASE_URL],
      `http://${TEST_HOST}:${CONSTRUCT_FREE_PORT}`,
    );
    assert.equal(vars[API_PUBLIC_BASE_URL], PUBLIC_BASE_URL);
  });

  it("publishes the reserved port and binds it without drift", async () => {
    stubRuntime(true);
    await blockPort(CONSTRUCT_TAKEN_PORT);

    const vars = await publish(singleServerConfig(CONSTRUCT_TAKEN_PORT));
    assert.equal(vars[API_PORT], CONSTRUCT_TAKEN_PORT + 1);

    start();
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].port, vars[API_PORT]);
  });

  it("fails the boot when strictPort cannot reserve the requested port", async () => {
    stubRuntime(true);
    await blockPort(CONSTRUCT_STRICT_PORT);

    const config = singleServerConfig(CONSTRUCT_STRICT_PORT);
    config.strictPort = true;

    await assert.rejects(publish(config), PortReservationError);
  });

  it("fails the boot when publicBaseUrl is missing outside of development", async () => {
    stubRuntime(false);

    const config = singleServerConfig(CONSTRUCT_FREE_PORT);
    delete config.publicBaseUrl;

    await assert.rejects(publish(config), MissingPublicBaseUrlError);
  });

  it("defaults publicBaseUrl to the local base url in development", async () => {
    stubRuntime(true);

    const config = singleServerConfig(CONSTRUCT_FREE_PORT);
    delete config.publicBaseUrl;

    const vars = await publish(config);

    assert.equal(
      vars[API_PUBLIC_BASE_URL],
      `http://${TEST_HOST}:${CONSTRUCT_FREE_PORT}`,
    );
  });
});
