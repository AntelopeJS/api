import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { HandlerPriority } from "@antelopejs/interface-api";

import { registerHandler, requestListener, unregisterHandler } from "../server";
import type { RouteDefinition } from "../route-table";

interface TestResponse {
  body: string;
  status: number;
}

const registeredIds = new Set<string>();
let server: Server;
let baseUrl: string;

function register(id: string, route: RouteDefinition, body: string) {
  registeredIds.add(id);
  registerHandler(id, route, () => body);
}

async function request(path: string, method = "GET"): Promise<TestResponse> {
  const response = await fetch(`${baseUrl}${path}`, { method });
  return { body: await response.text(), status: response.status };
}

function dispatchCases(): void {
  it("preserves static, dynamic, and any precedence", async () => {
    register(
      "dispatch-any",
      { mode: "handler", method: undefined, location: "/dispatch/value" },
      "any",
    );
    register(
      "dispatch-dynamic",
      { mode: "handler", method: "GET", location: "/dispatch/:id" },
      "dynamic",
    );
    register(
      "dispatch-static",
      { mode: "handler", method: "GET", location: "/dispatch/value" },
      "static",
    );

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
    register(
      "dispatch-head-get",
      { mode: "handler", method: "GET", location: "/dispatch/head" },
      "get",
    );
    register(
      "dispatch-options",
      { mode: "handler", method: "OPTIONS", location: "/dispatch/options" },
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
}

function exactEntryCases(): void {
  it("invalidates the exact entry across remove and hot reload", async () => {
    register(
      "dispatch-reload-old",
      { mode: "handler", method: "GET", location: "/dispatch/reload" },
      "old",
    );
    assert.equal((await request("/dispatch/reload")).body, "old");

    unregisterHandler("dispatch-reload-old");
    registeredIds.delete("dispatch-reload-old");
    assert.equal((await request("/dispatch/reload")).status, 404);

    register(
      "dispatch-reload-new",
      { mode: "handler", method: "GET", location: "/dispatch/reload" },
      "new",
    );
    assert.equal((await request("/dispatch/reload")).body, "new");
  });

  it("falls back for multiple handlers and restores the exact entry", async () => {
    register(
      "dispatch-first",
      { mode: "handler", method: "GET", location: "/dispatch/duplicate" },
      "first",
    );
    register(
      "dispatch-second",
      { mode: "handler", method: "GET", location: "/dispatch/duplicate" },
      "second",
    );
    assert.equal((await request("/dispatch/duplicate")).body, "first");

    unregisterHandler("dispatch-first");
    registeredIds.delete("dispatch-first");
    assert.equal((await request("/dispatch/duplicate")).body, "second");
  });

  it("keeps duplicate IDs on separate routes independently invalidated", async () => {
    register(
      "dispatch-shared",
      { mode: "handler", method: "GET", location: "/dispatch/shared-a" },
      "a",
    );
    register(
      "dispatch-shared",
      { mode: "handler", method: "GET", location: "/dispatch/shared-b" },
      "b",
    );

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
      {
        mode: "prefix",
        method: "GET",
        location: "/dispatch/priority",
        priority: HandlerPriority.LOW,
      },
      "late",
    );
    register(
      "dispatch-prefix-early",
      {
        mode: "prefix",
        method: "GET",
        location: "/dispatch/priority",
        priority: HandlerPriority.HIGH,
      },
      "early",
    );
    register(
      "dispatch-priority-handler",
      { mode: "handler", method: "GET", location: "/dispatch/priority" },
      "handler",
    );

    assert.equal((await request("/dispatch/priority")).body, "early");
  });
}

describe("Static route dispatch", () => {
  before(async () => {
    server = createServer((req, res) => void requestListener(req, res, "http"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!(address instanceof Object)) {
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

  dispatchCases();
  exactEntryCases();
});
