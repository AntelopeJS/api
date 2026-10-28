import assert from "node:assert";
import * as http from "node:http";

import {
  type RequestContext,
  type RouteCallback,
  registerHandler,
  requestListener,
  unregisterHandler,
} from "../server";
import type { RouteDefinition } from "../route-table";

const registeredIds: string[] = [];
let testServer: http.Server;
let baseUrl: string;

function register(id: string, route: RouteDefinition, callback: RouteCallback) {
  registeredIds.push(id);
  registerHandler(id, route, callback);
}

async function request(path: string, method = "GET") {
  const response = await fetch(`${baseUrl}${path}`, { method });
  return { status: response.status, body: await response.text() };
}

function segmentMatchingCases(): void {
  it("preserves static, dynamic, then catch-all precedence", async () => {
    register(
      "compiled-static",
      { mode: "handler", method: "get", location: "/compiled/static" },
      () => "static",
    );
    register(
      "compiled-dynamic",
      { mode: "handler", method: "get", location: "/compiled/:id" },
      () => "dynamic",
    );
    register(
      "compiled-catch",
      { mode: "handler", method: "get", location: "/compiled/::path" },
      () => "catch-all",
    );

    assert.equal((await request("/compiled/static")).body, "static");
    assert.equal((await request("/compiled/value")).body, "dynamic");
    assert.equal((await request("/compiled/a/b")).body, "catch-all");
  });

  it("extracts multiple segments and patterned segment parameters", async () => {
    register(
      "compiled-pattern",
      {
        mode: "handler",
        method: "get",
        location: "/compiled/:team/files/:base.:extension",
      },
      ({ routeParameters }) => JSON.stringify(routeParameters),
    );

    const response = await request("/compiled/core/files/report.final.json");
    assert.deepEqual(JSON.parse(response.body), {
      team: "core",
      base: "report",
      extension: "final.json",
    });
  });

  it("keeps URL-encoded captures unchanged", async () => {
    register(
      "compiled-encoded",
      { mode: "handler", method: "get", location: "/compiled/encoded/:value" },
      ({ routeParameters }) => routeParameters.value,
    );

    assert.equal(
      (await request("/compiled/encoded/caf%C3%A9%20cr%C3%A8me")).body,
      "caf%C3%A9%20cr%C3%A8me",
    );
  });

  it("backtracks across concurrent dynamic routes", async () => {
    register(
      "compiled-early",
      { mode: "handler", method: "get", location: "/compiled/items/p:id" },
      () => "early",
    );
    register(
      "compiled-late",
      {
        mode: "handler",
        method: "get",
        location: "/compiled/items/:slug.json",
      },
      ({ routeParameters }) => routeParameters.slug,
    );
    register(
      "compiled-dead-branch",
      {
        mode: "handler",
        method: "get",
        location: "/compiled/branch/:first/missing",
      },
      () => "dead",
    );
    register(
      "compiled-live-branch",
      {
        mode: "handler",
        method: "get",
        location: "/compiled/branch/:second/:third",
      },
      ({ routeParameters }) => JSON.stringify(routeParameters),
    );

    assert.equal((await request("/compiled/items/report.json")).body, "report");
    assert.equal((await request("/compiled/items/p123")).body, "early");
    assert.deepEqual(JSON.parse((await request("/compiled/branch/a/b")).body), {
      second: "a",
      third: "b",
    });
  });
}

function parameterIsolationCases(): void {
  it("preserves prefixed and suffixed dynamic segment matching", async () => {
    register(
      "compiled-filter-prefix",
      {
        mode: "handler",
        method: "get",
        location: "/compiled/filter/pre:id.json",
      },
      ({ routeParameters }) => `prefix:${routeParameters.id}`,
    );
    register(
      "compiled-filter-suffix",
      {
        mode: "handler",
        method: "get",
        location: "/compiled/filter/:first-:second.tail",
      },
      ({ routeParameters }) =>
        `suffix:${routeParameters.first}:${routeParameters.second}`,
    );

    assert.equal(
      (await request("/compiled/filter/prevalue.json")).body,
      "prefix:value",
    );
    assert.equal(
      (await request("/compiled/filter/left-right.tail")).body,
      "suffix:left:right",
    );
    assert.equal((await request("/compiled/filter/value.json")).status, 404);
  });

  it("isolates parameter objects for multiple handlers", async () => {
    const observed: string[] = [];
    register(
      "compiled-prefix-first",
      { mode: "prefix", method: "get", location: "/compiled/isolated/:id" },
      ({ routeParameters }) => {
        observed.push(routeParameters.id);
        routeParameters.id = "mutated";
      },
    );
    register(
      "compiled-prefix-second",
      { mode: "prefix", method: "get", location: "/compiled/isolated/:id" },
      ({ routeParameters }) => {
        observed.push(routeParameters.id);
      },
    );
    register(
      "compiled-isolated-handler",
      { mode: "handler", method: "get", location: "/compiled/isolated/:id" },
      ({ routeParameters }) => routeParameters.id,
    );

    assert.equal(
      (await request("/compiled/isolated/original")).body,
      "original",
    );
    assert.deepEqual(observed, ["original", "original"]);
  });

  it("provides independent parameters to middleware and monitors", async () => {
    const parameters: RequestContext["routeParameters"][] = [];
    const observe = (context: RequestContext) => {
      parameters.push(context.routeParameters);
    };
    register(
      "compiled-modes-prefix",
      { mode: "prefix", method: "get", location: "/compiled/modes/:id" },
      observe,
    );
    register(
      "compiled-modes-handler",
      { mode: "handler", method: "get", location: "/compiled/modes/:id" },
      observe,
    );
    register(
      "compiled-modes-postfix",
      { mode: "postfix", method: "get", location: "/compiled/modes/:id" },
      observe,
    );
    register(
      "compiled-modes-monitor",
      { mode: "monitor", method: "get", location: "/compiled/modes/:id" },
      observe,
    );

    await request("/compiled/modes/value");

    assert.deepEqual(
      parameters.map(({ id }) => id),
      ["value", "value", "value", "value"],
    );
    assert.equal(new Set(parameters).size, 4);
  });
}

function routeLifecycleCases(): void {
  it("falls back to any handlers with extracted parameters", async () => {
    register(
      "compiled-any",
      { mode: "handler", method: undefined, location: "/compiled/any/:id" },
      ({ routeParameters }) => routeParameters.id,
    );

    assert.equal((await request("/compiled/any/value", "PATCH")).body, "value");
  });

  it("reuses compiled routes after unregister and re-register", async () => {
    register(
      "compiled-lifecycle-old",
      { mode: "handler", method: "get", location: "/compiled/lifecycle/:id" },
      () => "old",
    );
    assert.equal((await request("/compiled/lifecycle/value")).body, "old");

    unregisterHandler("compiled-lifecycle-old");
    registeredIds.splice(registeredIds.indexOf("compiled-lifecycle-old"), 1);
    assert.equal((await request("/compiled/lifecycle/value")).status, 404);

    register(
      "compiled-lifecycle-new",
      { mode: "handler", method: "get", location: "/compiled/lifecycle/:id" },
      ({ routeParameters }) => `new:${routeParameters.id}`,
    );
    assert.equal(
      (await request("/compiled/lifecycle/value")).body,
      "new:value",
    );
  });
}

describe("Compiled route parameter extraction", () => {
  before(async () => {
    testServer = http.createServer(
      (req, res) => void requestListener(req, res, "http"),
    );
    await new Promise<void>((resolve) =>
      testServer.listen(0, "127.0.0.1", resolve),
    );
    const address = testServer.address();
    assert.ok(address instanceof Object);
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      testServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  afterEach(() => {
    for (const id of registeredIds.splice(0)) {
      unregisterHandler(id);
    }
  });

  segmentMatchingCases();
  parameterIsolationCases();
  routeLifecycleCases();
});
