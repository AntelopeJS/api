import assert from "node:assert";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { HandlerPriority } from "@antelopejs/interface-api";
import {
  type RequestContext,
  type RouteCallback,
  registerHandler,
  requestListener,
  unregisterHandler,
} from "../server";

type RouteMode = Parameters<typeof registerHandler>[1];

const registeredIds: string[] = [];
let testServer: http.Server;
let baseUrl: string;

function register(
  id: string,
  mode: RouteMode,
  method: string | undefined,
  location: string,
  callback: RouteCallback,
  priority = HandlerPriority.NORMAL,
) {
  registeredIds.push(id);
  registerHandler(id, mode, method, location, callback, priority);
}

async function request(path: string, method = "GET") {
  const response = await fetch(`${baseUrl}${path}`, { method });
  return { status: response.status, body: await response.text() };
}

describe("Compiled route parameter extraction", () => {
  before(async () => {
    testServer = http.createServer(
      (req, res) => void requestListener(req, res, "http"),
    );
    await new Promise<void>((resolve) =>
      testServer.listen(0, "127.0.0.1", resolve),
    );
    const address = testServer.address() as AddressInfo;
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

  it("preserves static, dynamic, then catch-all precedence", async () => {
    register(
      "compiled-static",
      "handler",
      "get",
      "/compiled/static",
      () => "static",
    );
    register(
      "compiled-dynamic",
      "handler",
      "get",
      "/compiled/:id",
      () => "dynamic",
    );
    register(
      "compiled-catch",
      "handler",
      "get",
      "/compiled/::path",
      () => "catch-all",
    );

    assert.equal((await request("/compiled/static")).body, "static");
    assert.equal((await request("/compiled/value")).body, "dynamic");
    assert.equal((await request("/compiled/a/b")).body, "catch-all");
  });

  it("extracts multiple segments and patterned segment parameters", async () => {
    register(
      "compiled-pattern",
      "handler",
      "get",
      "/compiled/:team/files/:base.:extension",
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
      "handler",
      "get",
      "/compiled/encoded/:value",
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
      "handler",
      "get",
      "/compiled/items/p:id",
      () => "early",
    );
    register(
      "compiled-late",
      "handler",
      "get",
      "/compiled/items/:slug.json",
      ({ routeParameters }) => routeParameters.slug,
    );
    register(
      "compiled-dead-branch",
      "handler",
      "get",
      "/compiled/branch/:first/missing",
      () => "dead",
    );
    register(
      "compiled-live-branch",
      "handler",
      "get",
      "/compiled/branch/:second/:third",
      ({ routeParameters }) => JSON.stringify(routeParameters),
    );

    assert.equal((await request("/compiled/items/report.json")).body, "report");
    assert.equal((await request("/compiled/items/p123")).body, "early");
    assert.deepEqual(JSON.parse((await request("/compiled/branch/a/b")).body), {
      second: "a",
      third: "b",
    });
  });

  it("preserves prefixed and suffixed dynamic segment matching", async () => {
    register(
      "compiled-filter-prefix",
      "handler",
      "get",
      "/compiled/filter/pre:id.json",
      ({ routeParameters }) => `prefix:${routeParameters.id}`,
    );
    register(
      "compiled-filter-suffix",
      "handler",
      "get",
      "/compiled/filter/:first-:second.tail",
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
      "prefix",
      "get",
      "/compiled/isolated/:id",
      ({ routeParameters }) => {
        observed.push(routeParameters.id);
        routeParameters.id = "mutated";
      },
    );
    register(
      "compiled-prefix-second",
      "prefix",
      "get",
      "/compiled/isolated/:id",
      ({ routeParameters }) => {
        observed.push(routeParameters.id);
      },
    );
    register(
      "compiled-isolated-handler",
      "handler",
      "get",
      "/compiled/isolated/:id",
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
      "prefix",
      "get",
      "/compiled/modes/:id",
      observe,
    );
    register(
      "compiled-modes-handler",
      "handler",
      "get",
      "/compiled/modes/:id",
      observe,
    );
    register(
      "compiled-modes-postfix",
      "postfix",
      "get",
      "/compiled/modes/:id",
      observe,
    );
    register(
      "compiled-modes-monitor",
      "monitor",
      "get",
      "/compiled/modes/:id",
      observe,
    );

    await request("/compiled/modes/value");

    assert.deepEqual(
      parameters.map(({ id }) => id),
      ["value", "value", "value", "value"],
    );
    assert.equal(new Set(parameters).size, 4);
  });

  it("falls back to any handlers with extracted parameters", async () => {
    register(
      "compiled-any",
      "handler",
      undefined,
      "/compiled/any/:id",
      ({ routeParameters }) => routeParameters.id,
    );

    assert.equal((await request("/compiled/any/value", "PATCH")).body, "value");
  });

  it("reuses compiled routes after unregister and re-register", async () => {
    register(
      "compiled-lifecycle-old",
      "handler",
      "get",
      "/compiled/lifecycle/:id",
      () => "old",
    );
    assert.equal((await request("/compiled/lifecycle/value")).body, "old");

    unregisterHandler("compiled-lifecycle-old");
    registeredIds.splice(registeredIds.indexOf("compiled-lifecycle-old"), 1);
    assert.equal((await request("/compiled/lifecycle/value")).status, 404);

    register(
      "compiled-lifecycle-new",
      "handler",
      "get",
      "/compiled/lifecycle/:id",
      ({ routeParameters }) => `new:${routeParameters.id}`,
    );
    assert.equal(
      (await request("/compiled/lifecycle/value")).body,
      "new:value",
    );
  });
});
