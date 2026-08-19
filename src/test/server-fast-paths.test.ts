import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { HandlerPriority } from "@antelopejs/interface-api";
import { registerHandler, requestListener, unregisterHandler } from "../server";

const TEST_HOST = "127.0.0.1";
const TEST_PATH = "/server-fast-path-lifecycle";
const HANDLER_ID = "server-fast-path-handler";
const PREFIX_HIGH_ID = "server-fast-path-prefix-high";
const PREFIX_LOW_ID = "server-fast-path-prefix-low";
const POSTFIX_ID = "server-fast-path-postfix";
const MONITOR_ID = "server-fast-path-monitor";
const ROUTE_IDS = [
  HANDLER_ID,
  PREFIX_HIGH_ID,
  PREFIX_LOW_ID,
  POSTFIX_ID,
  MONITOR_ID,
];

interface TestResponse {
  status: number;
  body: string;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, TEST_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request(port: number): Promise<TestResponse> {
  const response = await fetch(`http://${TEST_HOST}:${port}${TEST_PATH}`);
  return { status: response.status, body: await response.text() };
}

describe("Server middleware fast paths", () => {
  const events: string[] = [];
  const server = createServer((incoming, response) => {
    void requestListener(incoming, response, "http");
  });
  let port: number;

  before(async () => {
    port = await listen(server);
    registerHandler(HANDLER_ID, "handler", "get", TEST_PATH, () => {
      events.push("handler");
      return "ok";
    });
  });

  after(async () => {
    ROUTE_IDS.forEach(unregisterHandler);
    await close(server);
  });

  beforeEach(() => {
    events.length = 0;
  });

  it("preserves lifecycle behavior as middleware is added and removed", async () => {
    assert.deepEqual(await request(port), { status: 200, body: "ok" });
    assert.deepEqual(events, ["handler"]);

    registerHandler(
      PREFIX_LOW_ID,
      "prefix",
      "get",
      TEST_PATH,
      () => {
        events.push("prefix-low");
      },
      HandlerPriority.LOW,
    );
    registerHandler(
      PREFIX_HIGH_ID,
      "prefix",
      "get",
      TEST_PATH,
      () => {
        events.push("prefix-high");
      },
      HandlerPriority.HIGH,
    );
    registerHandler(POSTFIX_ID, "postfix", "get", TEST_PATH, () => {
      events.push("postfix");
    });
    registerHandler(MONITOR_ID, "monitor", "get", TEST_PATH, () => {
      events.push("monitor");
    });

    events.length = 0;
    assert.deepEqual(await request(port), { status: 200, body: "ok" });
    assert.deepEqual(events, [
      "prefix-high",
      "prefix-low",
      "handler",
      "postfix",
      "monitor",
    ]);

    [PREFIX_HIGH_ID, PREFIX_LOW_ID, POSTFIX_ID, MONITOR_ID].forEach(
      unregisterHandler,
    );
    events.length = 0;
    assert.deepEqual(await request(port), { status: 200, body: "ok" });
    assert.deepEqual(events, ["handler"]);
  });
});
