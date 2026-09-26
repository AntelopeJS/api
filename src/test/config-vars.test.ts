import sinon from "sinon";
import * as net from "node:net";
import assert from "node:assert";
import * as coreRuntime from "@antelopejs/interface-core/runtime";
import type { ConfigVars } from "@antelopejs/interface-core/config";

import { setDevMode } from "../dev-mode";
import { LOOPBACK_HOST } from "../server-origin";
import { collectListeningEndpoints } from "../dev-registry";
import type { Config, ServerConfig } from "../server-config";
import {
  type BoundListener,
  bindServerPorts,
  closeListeners,
  PortReservationError,
} from "../port-listener";
import {
  API_LOCAL_BASE_URL,
  API_PORT,
  API_PUBLIC_BASE_URL,
  buildConfigVars,
  MissingPublicBaseUrlError,
} from "../config-vars";
import {
  applyReservedPorts,
  configure,
  getConfig,
  getListeningEndpoints,
  listenServers,
  provide,
  start,
  stop,
} from "../index";

const TEST_HOST = "127.0.0.1";
const BOUND_FREE_PORT = 25200;
const BOUND_TAKEN_PORT = 25210;
const BOUND_STRICT_PORT = 25220;
const CONSTRUCT_FREE_PORT = 25230;
const CONSTRUCT_TAKEN_PORT = 25240;
const CONSTRUCT_STRICT_PORT = 25250;
const SECONDARY_PORT = 25260;
const REBUILT_CONFIG_PORT = 25270;
const AGREEMENT_PORT = 25290;
const HELD_LISTENER_PORT = 25280;
const LISTENER_HOLD_MS = 250;
const RANDOM_PORT = 0;
const PUBLIC_BASE_URL = "https://api.example.com";

interface LocalHostCase {
  bindHost?: string;
  urlHost: string;
}

interface PortInUseError {
  code?: string;
}

function isPortInUseError(error: unknown): boolean {
  return (error as PortInUseError).code === "EADDRINUSE";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function stubRuntime(dev: boolean): void {
  sinon
    .stub(coreRuntime, "GetRuntimeInfo")
    .resolves({ dev, projectPath: "", env: "test" });
  sinon.stub(coreRuntime, "RegisterDevServer").resolves();
  setDevMode(dev);
}

function publish(config: Config): Promise<ConfigVars> {
  return provide(config);
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
        { protocol: "http", host: TEST_HOST, port: BOUND_FREE_PORT },
        { protocol: "http", host: TEST_HOST, port: SECONDARY_PORT },
      ],
    });

    assert.equal(vars[API_PORT], BOUND_FREE_PORT);
    assert.equal(
      vars[API_LOCAL_BASE_URL],
      `http://${TEST_HOST}:${BOUND_FREE_PORT}`,
    );
    assert.equal(vars[API_PUBLIC_BASE_URL], PUBLIC_BASE_URL);
  });

  it("maps every bind host to a connectable url host", () => {
    const hostCases: LocalHostCase[] = [
      { bindHost: undefined, urlHost: TEST_HOST },
      { bindHost: "0.0.0.0", urlHost: TEST_HOST },
      { bindHost: "::", urlHost: TEST_HOST },
      { bindHost: "[::]", urlHost: TEST_HOST },
      { bindHost: "localhost", urlHost: "localhost" },
      { bindHost: "192.168.1.5", urlHost: "192.168.1.5" },
      { bindHost: "::1", urlHost: "[::1]" },
      { bindHost: "[::1]", urlHost: "[::1]" },
    ];

    for (const { bindHost, urlHost } of hostCases) {
      const vars = buildConfigVars({
        publicBaseUrl: PUBLIC_BASE_URL,
        servers: [{ protocol: "http", host: bindHost, port: BOUND_FREE_PORT }],
      });

      assert.equal(
        vars[API_LOCAL_BASE_URL],
        `http://${urlHost}:${BOUND_FREE_PORT}`,
        `bind host ${String(bindHost)}`,
      );
    }
  });

  it("follows the protocol of the first configured server", () => {
    const vars = buildConfigVars({
      publicBaseUrl: PUBLIC_BASE_URL,
      servers: [{ protocol: "https", host: TEST_HOST, port: SECONDARY_PORT }],
    });

    assert.equal(
      vars[API_LOCAL_BASE_URL],
      `https://${TEST_HOST}:${SECONDARY_PORT}`,
    );
  });

  it("defaults the public base url to the local one in development", () => {
    setDevMode(true);

    const vars = buildConfigVars({
      servers: [{ protocol: "http", host: TEST_HOST, port: BOUND_FREE_PORT }],
    });

    assert.equal(vars[API_PUBLIC_BASE_URL], vars[API_LOCAL_BASE_URL]);
  });

  it("rejects a missing public base url outside of development", () => {
    setDevMode(false);

    assert.throws(
      () =>
        buildConfigVars({
          servers: [
            { protocol: "http", host: TEST_HOST, port: BOUND_FREE_PORT },
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
      servers: [{ protocol: "http", host: TEST_HOST, port: BOUND_FREE_PORT }],
    });

    assert.equal(vars[API_PUBLIC_BASE_URL], PUBLIC_BASE_URL);
  });
});

describe("Port binding", () => {
  const blockers: net.Server[] = [];
  let listeners: BoundListener[] = [];

  async function blockPort(port: number): Promise<void> {
    blockers.push(await occupyPort(port));
  }

  afterEach(async () => {
    await closeListeners(listeners);
    listeners = [];
    await Promise.all(blockers.map((blocker) => closeServer(blocker)));
    blockers.length = 0;
  });

  it("binds the requested port and writes it back to the config", async () => {
    const servers = singleServerConfig(BOUND_FREE_PORT).servers ?? [];

    listeners = await bindServerPorts(servers, false);

    assert.equal(listeners[0].port, BOUND_FREE_PORT);
    assert.equal(servers[0].port, BOUND_FREE_PORT);
  });

  it("binds the next free port when fallback is allowed", async () => {
    await blockPort(BOUND_TAKEN_PORT);
    const servers = singleServerConfig(BOUND_TAKEN_PORT).servers ?? [];

    listeners = await bindServerPorts(servers, true);

    assert.equal(listeners[0].port, BOUND_TAKEN_PORT + 1);
    assert.equal(servers[0].port, BOUND_TAKEN_PORT + 1);
  });

  it("fails with a named error when fallback is not allowed", async () => {
    await blockPort(BOUND_STRICT_PORT);
    const servers = singleServerConfig(BOUND_STRICT_PORT).servers ?? [];

    await assert.rejects(
      bindServerPorts(servers, false),
      (error: Error) =>
        error instanceof PortReservationError &&
        error.name === "PortReservationError" &&
        error.message.includes(String(BOUND_STRICT_PORT)),
    );
  });

  it("binds an operating system assigned port for port 0", async () => {
    const servers = singleServerConfig(RANDOM_PORT).servers ?? [];

    listeners = await bindServerPorts(servers, false);

    assert.ok(listeners[0].port > 0);
    assert.equal(servers[0].port, listeners[0].port);
  });

  it("closes every listener when one of them fails", async () => {
    await blockPort(BOUND_STRICT_PORT);

    await assert.rejects(
      bindServerPorts(
        [
          { protocol: "http", host: TEST_HOST, port: SECONDARY_PORT },
          { protocol: "http", host: TEST_HOST, port: BOUND_STRICT_PORT },
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

  it("publishes the bound port and serves it without drift", async () => {
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

  it("re-applies the bound port to the configuration construct receives", async () => {
    stubRuntime(true);
    await blockPort(REBUILT_CONFIG_PORT);

    const vars = await publish(singleServerConfig(REBUILT_CONFIG_PORT));
    assert.equal(vars[API_PORT], REBUILT_CONFIG_PORT + 1);

    configure(singleServerConfig(REBUILT_CONFIG_PORT));
    assert.equal(getConfig().servers?.[0].port, REBUILT_CONFIG_PORT);

    applyReservedPorts();
    assert.equal(getConfig().servers?.[0].port, vars[API_PORT]);

    start();
    await listenServers();

    assert.equal(getListeningEndpoints()[0].port, vars[API_PORT]);
  });

  it("holds the bound port across a long provide to start window", async () => {
    stubRuntime(false);

    const vars = await publish(singleServerConfig(HELD_LISTENER_PORT));
    assert.equal(vars[API_PORT], HELD_LISTENER_PORT);

    await assert.rejects(occupyPort(HELD_LISTENER_PORT), isPortInUseError);
    await delay(LISTENER_HOLD_MS);
    await assert.rejects(occupyPort(HELD_LISTENER_PORT), isPortInUseError);

    start();
    await listenServers();

    assert.equal(getListeningEndpoints()[0].port, HELD_LISTENER_PORT);
  });

  it("fails the boot when strictPort cannot bind the requested port", async () => {
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

  it("advertises one origin in the dev registry and in the variables", async () => {
    stubRuntime(true);

    const vars = await publish({
      servers: [{ protocol: "http", port: AGREEMENT_PORT }],
    });

    start();
    await listenServers();

    const [endpoint] = getListeningEndpoints();
    assert.equal(
      `${endpoint.protocol}://${endpoint.host}:${endpoint.port}`,
      vars[API_LOCAL_BASE_URL],
    );
    assert.equal(vars[API_PUBLIC_BASE_URL], vars[API_LOCAL_BASE_URL]);
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

describe("Advertised host agreement", () => {
  const BIND_HOSTS = [
    undefined,
    "0.0.0.0",
    "::",
    "[::]",
    "localhost",
    "192.168.1.5",
    "api.internal",
    "::1",
    "[::1]",
  ];

  function listenOnFreePort(): Promise<net.Server> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, TEST_HOST, () => resolve(server));
    });
  }

  function boundPort(server: net.Server): number {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return address.port;
  }

  it("advertises loopback as 127.0.0.1 for an absent or wildcard host", () => {
    const loopbackHosts = [undefined, "0.0.0.0", "::", "[::]"];

    for (const host of loopbackHosts) {
      const vars = buildConfigVars({
        publicBaseUrl: PUBLIC_BASE_URL,
        servers: [{ protocol: "http", host, port: BOUND_FREE_PORT }],
      });

      assert.equal(
        vars[API_LOCAL_BASE_URL],
        `http://${LOOPBACK_HOST}:${BOUND_FREE_PORT}`,
        `bind host ${String(host)}`,
      );
    }
  });

  it("names the server identically in the dev registry and in API_LOCAL_BASE_URL", async () => {
    const server = await listenOnFreePort();

    try {
      for (const host of BIND_HOSTS) {
        const servers: ServerConfig[] = [
          { protocol: "http", host, port: boundPort(server) },
        ];

        const [endpoint] = collectListeningEndpoints([server], servers);
        const vars = buildConfigVars({
          publicBaseUrl: PUBLIC_BASE_URL,
          servers,
        });

        assert.equal(
          `${endpoint.protocol}://${endpoint.host}:${endpoint.port}`,
          vars[API_LOCAL_BASE_URL],
          `bind host ${String(host)}`,
        );
      }
    } finally {
      await closeServer(server);
    }
  });
});
