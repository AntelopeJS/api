import sinon from "sinon";
import * as coreRuntime from "@antelopejs/interface-core/runtime";

import {
  configure,
  getConfig,
  getListeningEndpoints,
  start,
  stop,
} from "../index";

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

/**
 * Stubs the core runtime as a dev or production project and returns the
 * `RegisterDevServer` stub.
 */
export function stubRuntime(dev: boolean): sinon.SinonStub {
  sinon
    .stub(coreRuntime, "GetRuntimeInfo")
    .resolves({ dev, projectPath: "", env: "test" });
  return sinon.stub(coreRuntime, "RegisterDevServer").resolves();
}

/**
 * Registers hooks for the enclosing `describe`: each test ends with the
 * servers stopped and sinon restored, and the suite ends with the test
 * project's own configuration listening again.
 */
export function restoreServersAfterEach(): void {
  let originalConfig: ReturnType<typeof getConfig>;

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
  });
}
