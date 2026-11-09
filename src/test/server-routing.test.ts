import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { HandlerPriority, HTTPResult } from "@antelopejs/interface-api";

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

function anyMethodCases(): void {
  it("runs a prefix declared for the method * on every method", async () => {
    register(
      "star-get",
      { mode: "handler", method: "GET", location: "/star/prefix" },
      "get",
    );
    register(
      "star-post",
      { mode: "handler", method: "POST", location: "/star/prefix" },
      "post",
    );
    registeredIds.add("star-prefix");
    registerHandler(
      "star-prefix",
      { mode: "prefix", method: "*", location: "/star/prefix" },
      () => new HTTPResult(418, "any method"),
    );

    assert.deepEqual(await request("/star/prefix"), {
      body: "any method",
      status: 418,
    });
    assert.deepEqual(await request("/star/prefix", "POST"), {
      body: "any method",
      status: 418,
    });
  });

  it("runs a postfix and a monitor declared for the method * on every method", async () => {
    const monitored: string[] = [];
    register(
      "star-handler",
      { mode: "handler", method: "DELETE", location: "/star/after" },
      "deleted",
    );
    registeredIds.add("star-postfix");
    registerHandler(
      "star-postfix",
      { mode: "postfix", method: "*", location: "/star/after" },
      () => new HTTPResult(202, "postfix"),
    );
    registeredIds.add("star-monitor");
    registerHandler(
      "star-monitor",
      { mode: "monitor", method: "*", location: "/star/after" },
      ({ response }) => {
        monitored.push(String(response.getBody()));
      },
    );

    assert.deepEqual(await request("/star/after", "DELETE"), {
      body: "postfix",
      status: 202,
    });
    assert.deepEqual(monitored, ["postfix"]);
  });
}

function headFallbackCases(): void {
  it("runs the GET prefixes and monitors for a HEAD request served by the GET handler", async () => {
    const ran: string[] = [];
    registeredIds.add("head-get-prefix");
    registerHandler(
      "head-get-prefix",
      { mode: "prefix", method: "GET", location: "/head-fallback/refused" },
      () => new HTTPResult(401, "refused"),
    );
    registeredIds.add("head-get-handler");
    registerHandler(
      "head-get-handler",
      { mode: "handler", method: "GET", location: "/head-fallback/refused" },
      () => {
        ran.push("handler");
        return "get";
      },
    );
    registeredIds.add("head-get-monitor");
    registerHandler(
      "head-get-monitor",
      { mode: "monitor", method: "GET", location: "/head-fallback/refused" },
      () => {
        ran.push("monitor");
      },
    );

    assert.deepEqual(await request("/head-fallback/refused", "HEAD"), {
      body: "",
      status: 401,
    });
    assert.deepEqual(ran, ["monitor"]);
  });

  it("runs the GET postfixes for a HEAD request served by the GET handler", async () => {
    register(
      "head-postfix-handler",
      { mode: "handler", method: "GET", location: "/head-fallback/postfix" },
      "get",
    );
    registeredIds.add("head-get-postfix");
    registerHandler(
      "head-get-postfix",
      { mode: "postfix", method: "GET", location: "/head-fallback/postfix" },
      () => new HTTPResult(202, "postfix"),
    );

    assert.deepEqual(await request("/head-fallback/postfix", "HEAD"), {
      body: "",
      status: 202,
    });
  });

  it("keeps running the HEAD prefixes for a HEAD request served by the GET handler", async () => {
    register(
      "head-own-handler",
      { mode: "handler", method: "GET", location: "/head-fallback/own" },
      "get",
    );
    registeredIds.add("head-own-prefix");
    registerHandler(
      "head-own-prefix",
      { mode: "prefix", method: "HEAD", location: "/head-fallback/own" },
      () => new HTTPResult(403, "refused"),
    );

    assert.equal((await request("/head-fallback/own", "HEAD")).status, 403);
    assert.equal((await request("/head-fallback/own")).status, 200);
  });

  it("runs only the HEAD middleware when a HEAD handler is registered", async () => {
    register(
      "head-direct-handler",
      { mode: "handler", method: "HEAD", location: "/head-fallback/direct" },
      "head",
    );
    registeredIds.add("head-direct-get-prefix");
    registerHandler(
      "head-direct-get-prefix",
      { mode: "prefix", method: "GET", location: "/head-fallback/direct" },
      () => new HTTPResult(401, "refused"),
    );

    assert.equal((await request("/head-fallback/direct", "HEAD")).status, 200);
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
  anyMethodCases();
  headFallbackCases();
  exactEntryCases();
});
