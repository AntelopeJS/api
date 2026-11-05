import sinon from "sinon";
import assert from "node:assert";
import * as net from "node:net";
import { Events } from "@antelopejs/interface-core/modules";
import * as coreRuntime from "@antelopejs/interface-core/runtime";

import type { Config } from "../server-config";
import { watchModulesLifecycle } from "../startup-gate";
import {
  configure,
  destroy,
  getConfig,
  listenServers,
  provide,
  start,
} from "../index";

const TEST_HOST = "127.0.0.1";
const PROVIDED_PORT = 25500;
const SERVED_PORT = 25510;
const PUBLIC_BASE_URL = "https://api.example.com";

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

function bindPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, TEST_HOST, () => {
      probe.close(() => resolve());
    });
  });
}

describe("Destroying a module that never started", () => {
  let originalConfig: Config;

  before(() => {
    originalConfig = getConfig();
  });

  beforeEach(stubRuntime);

  afterEach(() => {
    sinon.restore();
  });

  after(() => {
    watchModulesLifecycle();
    Events.ModulesStarted.emit();
    if (!originalConfig.servers?.length) {
      return;
    }

    configure(originalConfig);
    start();
  });

  it("releases the port bound while providing config variables", async () => {
    await provide(singleServerConfig(PROVIDED_PORT));

    await destroy();

    await assert.doesNotReject(bindPort(PROVIDED_PORT));
  });

  it("releases the port of a server that serves requests", async () => {
    await provide(singleServerConfig(SERVED_PORT));
    start();
    await listenServers();

    await destroy();

    await assert.doesNotReject(bindPort(SERVED_PORT));
  });
});
