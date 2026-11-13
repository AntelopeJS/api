import assert from "node:assert";

import {
  configure,
  getConfig,
  getListeningEndpoints,
  listenServers,
  start,
} from "../index";
import { restoreServersAfterEach, stubRuntime } from "./listen-fixture";

const TEST_HOST = "127.0.0.1";
const STRING_PORT = 25160;

describe("Port fallback, untyped input", () => {
  restoreServersAfterEach();

  it("binds the numeric port when the configured port is a string", async () => {
    stubRuntime(true);

    configure({
      autoListen: false,
      servers: [
        { protocol: "http", host: TEST_HOST, port: String(STRING_PORT) },
      ],
    });
    start();
    await listenServers();

    const endpoints = getListeningEndpoints();
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].port, STRING_PORT);
    assert.equal(getConfig().servers?.[0].port, STRING_PORT);
  });

  it("rejects when the configured port is not a valid number", async () => {
    stubRuntime(true);

    configure({
      autoListen: false,
      servers: [{ protocol: "http", host: TEST_HOST, port: "not-a-port" }],
    });
    start();

    await assert.rejects(listenServers(), /Invalid http server port/);
  });
});
