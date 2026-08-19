import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { HandlerPriority } from "@antelopejs/interface-api";
import { registerHandler, requestListener, unregisterHandler } from "../server";

interface TestResponse {
  body: string;
  status: number;
}

const registeredIds = new Set<string>();
let server: Server;
let baseUrl: string;

function register(
  id: string,
  mode: "prefix" | "postfix" | "handler" | "monitor" | "websocket",
  method: string | undefined,
  location: string,
  body: string,
  priority = HandlerPriority.NORMAL,
) {
  registeredIds.add(id);
  registerHandler(id, mode, method, location, () => body, priority);
}

async function request(path: string, method = "GET"): Promise<TestResponse> {
  const response = await fetch(`${baseUrl}${path}`, { method });
  return { body: await response.text(), status: response.status };
}

describe("Static route dispatch", () => {
  before(async () => {
    server = createServer((req, res) => void requestListener(req, res, "http"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  afterEach(() => {
    for (const id of registeredIds) {
      unregisterHandler(id);
    }
    registeredIds.clear();
  });

  it("preserves static, dynamic, and any precedence", async () => {
    register("dispatch-any", "handler", undefined, "/dispatch/value", "any");
    register("dispatch-dynamic", "handler", "GET", "/dispatch/:id", "dynamic");
    register("dispatch-static", "handler", "GET", "/dispatch/value", "static");

    assert.deepEqual(await request("/dispatch/value"), {
      body: "static",
      status: 200,
    });
    assert.deepEqual(await request("/dispatch/other"), {
      body: "dynamic",
      status: 200,
    });
    assert.deepEqual(await request("/dispatch/value", "POST"), {
      body: "any",
      status: 200,
    });
  });

  it("preserves HEAD fallback and OPTIONS dispatch", async () => {
    register("dispatch-head-get", "handler", "GET", "/dispatch/head", "get");
    register(
      "dispatch-options",
      "handler",
      "OPTIONS",
      "/dispatch/options",
      "options",
    );

    assert.deepEqual(await request("/dispatch/head", "HEAD"), {
      body: "",
      status: 200,
    });
    assert.deepEqual(await request("/dispatch/options", "OPTIONS"), {
      body: "options",
      status: 200,
    });
    assert.equal((await request("/dispatch/missing", "OPTIONS")).status, 404);
  });

  it("invalidates the exact entry across remove and hot reload", async () => {
    register(
      "dispatch-reload-old",
      "handler",
      "GET",
      "/dispatch/reload",
      "old",
    );
    assert.equal((await request("/dispatch/reload")).body, "old");

    unregisterHandler("dispatch-reload-old");
    registeredIds.delete("dispatch-reload-old");
    assert.equal((await request("/dispatch/reload")).status, 404);

    register(
      "dispatch-reload-new",
      "handler",
      "GET",
      "/dispatch/reload",
      "new",
    );
    assert.equal((await request("/dispatch/reload")).body, "new");
  });

  it("falls back for multiple handlers and restores the exact entry", async () => {
    register(
      "dispatch-first",
      "handler",
      "GET",
      "/dispatch/duplicate",
      "first",
    );
    register(
      "dispatch-second",
      "handler",
      "GET",
      "/dispatch/duplicate",
      "second",
    );
    assert.equal((await request("/dispatch/duplicate")).body, "first");

    unregisterHandler("dispatch-first");
    registeredIds.delete("dispatch-first");
    assert.equal((await request("/dispatch/duplicate")).body, "second");
  });

  it("keeps duplicate IDs on separate routes independently invalidated", async () => {
    register("dispatch-shared", "handler", "GET", "/dispatch/shared-a", "a");
    register("dispatch-shared", "handler", "GET", "/dispatch/shared-b", "b");

    unregisterHandler("dispatch-shared");
    assert.equal((await request("/dispatch/shared-a")).status, 404);
    assert.equal((await request("/dispatch/shared-b")).body, "b");
    unregisterHandler("dispatch-shared");
    registeredIds.delete("dispatch-shared");
    assert.equal((await request("/dispatch/shared-b")).status, 404);
  });

  it("leaves multi-handler priority ordering unchanged", async () => {
    register(
      "dispatch-prefix-late",
      "prefix",
      "GET",
      "/dispatch/priority",
      "late",
      HandlerPriority.LOW,
    );
    register(
      "dispatch-prefix-early",
      "prefix",
      "GET",
      "/dispatch/priority",
      "early",
      HandlerPriority.HIGH,
    );
    register(
      "dispatch-priority-handler",
      "handler",
      "GET",
      "/dispatch/priority",
      "handler",
    );

    assert.equal((await request("/dispatch/priority")).body, "early");
  });
});
