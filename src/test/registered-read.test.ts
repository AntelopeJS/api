import { Socket } from "node:net";
import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { HTTPResult, type RouteHandler } from "@antelopejs/interface-api";
import { ExecuteRegisteredRead as ExecuteReadInterface } from "@antelopejs/interface-api/registered-read";

import type { RequestContext } from "../server";
import { ExecuteRegisteredRead, routesProxy } from "../implementations/api";

const ROOT = "/registered-read";
const RECORD_PATH = `${ROOT}/records/record-a`;
const FORBIDDEN = 403;
const registrations: string[] = [];
const events: string[] = [];
type InformationalWrite = (
  response: ServerResponse,
  callback?: () => void,
) => void;
const informationalWrites: Record<string, InformationalWrite> = {
  continue: (response, callback) => response.writeContinue(callback),
  processing: (response, callback) => response.writeProcessing(callback),
  hints: (response, callback) =>
    response.writeEarlyHints(
      { link: "</style.css>; rel=preload; as=style" },
      callback,
    ),
};

class ReadController {
  static location = ROOT;
  actor?: string;
}

function parentContext(): RequestContext {
  const request = new IncomingMessage(new Socket());
  request.headers = {
    authorization: "Bearer fixture",
    "content-length": "999",
  };
  request.method = "POST";
  request.url = "/files?bypass=true";
  return {
    rawRequest: request,
    rawResponse: new ServerResponse(request),
    url: new URL("http://localhost/files?bypass=true"),
    routeParameters: { id: "untrusted" },
    response: new HTTPResult(),
  };
}

function register(overrides: Partial<RouteHandler> = {}): string {
  const id = `registered-read-${registrations.length}`;
  class FixtureController extends ReadController {}
  registrations.push(id);
  routesProxy.register(id, {
    proto: FixtureController.prototype,
    mode: "handler",
    method: "get",
    location: `${ROOT}/records/:id`,
    properties: {},
    parameters: [],
    callback: () => ({ id: "record-a" }),
    ...overrides,
  });
  return id;
}

function read(
  routeId: string,
  context = parentContext(),
  pathname = RECORD_PATH,
) {
  return ExecuteRegisteredRead({ routeId, pathname }, context);
}

function registerContextPrefix(
  callback: (ctx: RequestContext) => unknown,
): void {
  register({
    mode: "prefix",
    location: ROOT,
    parameters: [{ provider: (ctx) => ctx, modifiers: [] }],
    callback,
  });
}

describe("Registered reads", () => {
  afterEach(() => {
    for (const id of registrations.splice(0)) routesProxy.unregister(id);
    events.length = 0;
  });

  it("binds the optional interface to the running API provider", async () => {
    const result = await ExecuteReadInterface(
      { routeId: register(), pathname: RECORD_PATH },
      parentContext(),
    );
    assert.deepEqual(JSON.parse(result.getBody()), { id: "record-a" });
  });

  it("runs prefixes, properties, parameters and postfixes without mutating the caller", async () => {
    register({
      mode: "prefix",
      location: ROOT,
      callback: () => {
        events.push("prefix");
      },
    });
    const routeId = register({
      properties: {
        actor: {
          provider: (ctx) => {
            events.push("property");
            return ctx.rawRequest.headers.authorization;
          },
          modifiers: [],
        },
      },
      parameters: [
        {
          provider: (ctx) => {
            events.push("parameter");
            assert.equal(ctx.url.search, "");
            assert.equal(ctx.rawRequest.method, "GET");
            assert.equal(ctx.rawRequest.url, RECORD_PATH);
            assert.equal(ctx.rawRequest.headers["content-length"], undefined);
            return ctx.routeParameters.id;
          },
          modifiers: [],
        },
      ],
      callback: function (this: ReadController, id: string) {
        events.push("handler");
        return { id, actor: this.actor };
      },
    });
    register({
      mode: "postfix",
      location: ROOT,
      callback: () => {
        events.push("postfix");
      },
    });
    const parent = parentContext();
    assert.deepEqual(JSON.parse((await read(routeId, parent)).getBody()), {
      id: "record-a",
      actor: "Bearer fixture",
    });
    assert.deepEqual(events, [
      "prefix",
      "property",
      "parameter",
      "handler",
      "postfix",
    ]);
    assert.equal(parent.rawRequest.method, "POST");
    assert.equal(parent.rawRequest.headers["content-length"], "999");
    assert.deepEqual(parent.routeParameters, { id: "untrusted" });
    assert.equal(parent.url.search, "?bypass=true");
  });

  it("never treats an early successful prefix response as document authorization", async () => {
    register({
      mode: "prefix",
      location: ROOT,
      callback: () => new HTTPResult(200, "intercepted"),
    });
    const routeId = register({
      callback: () => {
        events.push("handler");
      },
    });
    await assert.rejects(read(routeId), HTTPResult);
    assert.deepEqual(events, []);
  });

  it("rejects a prefix that writes to the raw response without returning a value", async () => {
    register({
      mode: "prefix",
      location: ROOT,
      parameters: [{ provider: (ctx) => ctx, modifiers: [] }],
      callback: (ctx: RequestContext) => {
        ctx.rawResponse.writeHead(200);
      },
    });
    const routeId = register({
      callback: () => {
        events.push("handler");
      },
    });
    const parent = parentContext();
    await assert.rejects(read(routeId, parent), HTTPResult);
    assert.deepEqual(events, []);
    assert.equal(parent.rawResponse.headersSent, false);
  });

  it("propagates property and parameter denials before executing the handler", async () => {
    const denied = () => {
      throw new HTTPResult(FORBIDDEN, "Denied");
    };
    const routeId = register({
      properties: { actor: { provider: denied, modifiers: [] } },
      callback: () => {
        events.push("handler");
      },
    });
    await assert.rejects(read(routeId), HTTPResult);
    routesProxy.unregister(routeId);
    const parameterRoute = register({
      parameters: [{ provider: () => "value", modifiers: [denied] }],
      callback: () => {
        events.push("handler");
      },
    });
    await assert.rejects(read(parameterRoute), HTTPResult);
    assert.deepEqual(events, []);
  });

  it("rejects an awaited raw response end instead of hanging", async () => {
    registerContextPrefix(
      (ctx) =>
        new Promise<void>((resolve) => ctx.rawResponse.end("denied", resolve)),
    );
    await assert.rejects(read(register()), HTTPResult);
  });

  for (const [name, write] of Object.entries(informationalWrites)) {
    for (const awaited of [false, true]) {
      it(`rejects ${name} informational output (awaited=${awaited})`, async () => {
        registerContextPrefix((ctx) =>
          awaited
            ? new Promise<void>((resolve) => write(ctx.rawResponse, resolve))
            : write(ctx.rawResponse),
        );
        const target = register({
          callback: () => {
            events.push("handler");
          },
        });
        await assert.rejects(read(target), HTTPResult);
        assert.deepEqual(events, []);
      });
    }
  }

  for (const deferred of [false, true]) {
    it(`stops dispatch after a parameter aborts (deferred=${deferred})`, async () => {
      const target = register({
        parameters: [
          {
            provider: (ctx) => {
              ctx.rawResponse.destroy();
              return deferred ? Promise.resolve("id") : "id";
            },
            modifiers: [],
          },
        ],
        callback: () => {
          events.push("handler");
        },
      });
      register({
        mode: "postfix",
        location: ROOT,
        callback: () => {
          events.push("postfix");
        },
      });
      await assert.rejects(read(target), HTTPResult);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(events, []);
    });
  }

  it("does not dispatch later prefixes after an interruption", async () => {
    registerContextPrefix((ctx) => {
      ctx.rawResponse.destroy();
    });
    registerContextPrefix(() => {
      events.push("later prefix");
    });
    await assert.rejects(read(register()), HTTPResult);
    assert.deepEqual(events, []);
  });

  for (const deferred of [false, true]) {
    it(`does not invoke a computed setter after interruption (deferred=${deferred})`, async () => {
      class SetterController {
        static location = ROOT;
        set actor(_value: unknown) {
          events.push("setter");
        }
      }
      const target = register({
        proto: SetterController.prototype,
        properties: {
          actor: {
            provider: (ctx) => {
              ctx.rawResponse.destroy();
              return deferred ? Promise.resolve("actor") : "actor";
            },
            modifiers: [],
          },
        },
        callback: () => {
          events.push("handler");
        },
      });
      await assert.rejects(read(target), HTTPResult);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(events, []);
    });
  }

  it("rejects raw response destruction before invoking the handler", async () => {
    registerContextPrefix((ctx) => {
      ctx.rawResponse.destroy();
    });
    const target = register({
      callback: () => {
        events.push("handler");
      },
    });
    await assert.rejects(read(target), HTTPResult);
    assert.deepEqual(events, []);
  });

  it("rejects child request destruction without destroying the parent socket", async () => {
    registerContextPrefix((ctx) => {
      ctx.rawRequest.destroy();
    });
    const parent = parentContext();
    const target = register({
      callback: () => {
        events.push("handler");
      },
    });
    await assert.rejects(read(target, parent), HTTPResult);
    assert.equal(parent.rawRequest.socket.destroyed, false);
    assert.equal(parent.rawRequest.destroyed, false);
    assert.deepEqual(events, []);
  });

  it("preserves independent credential views and removes framing headers from each", async () => {
    const parent = parentContext();
    parent.rawRequest.headers["x-many"] = ["first", "second"];
    parent.rawRequest.rawHeaders = [
      "Authorization",
      "Bearer fixture",
      "Content-Length",
      "999",
    ];
    parent.rawRequest.headersDistinct = {
      authorization: ["Bearer fixture"],
      "content-length": ["999"],
    };
    registerContextPrefix((ctx) => {
      assert.equal(ctx.rawRequest.socket, parent.rawRequest.socket);
      assert.equal(ctx.rawRequest.connection, parent.rawRequest.connection);
      assert.equal(ctx.rawRequest.headers.authorization, "Bearer fixture");
      assert.deepEqual(ctx.rawRequest.rawHeaders, [
        "Authorization",
        "Bearer fixture",
      ]);
      assert.deepEqual(ctx.rawRequest.headersDistinct, {
        authorization: ["Bearer fixture"],
      });
      const many = ctx.rawRequest.headers["x-many"];
      assert.ok(Array.isArray(many));
      many.push("child");
      ctx.rawRequest.headersDistinct.authorization!.push("child");
      ctx.rawRequest.rawHeaders.push("Child", "value");
    });
    await read(register(), parent);
    assert.deepEqual(parent.rawRequest.headers["x-many"], ["first", "second"]);
    assert.deepEqual(parent.rawRequest.headersDistinct.authorization, [
      "Bearer fixture",
    ]);
    assert.deepEqual(parent.rawRequest.rawHeaders, [
      "Authorization",
      "Bearer fixture",
      "Content-Length",
      "999",
    ]);
  });

  it("rejects non-finite response statuses", async () => {
    await assert.rejects(
      read(
        register({ callback: () => new HTTPResult(Number.NaN, "not success") }),
      ),
      HTTPResult,
    );
  });

  it("rejects handler and postfix denials", async () => {
    const denied = register({
      callback: () => new HTTPResult(FORBIDDEN, "Denied"),
    });
    await assert.rejects(read(denied), HTTPResult);
    routesProxy.unregister(denied);
    const allowed = register();
    register({
      mode: "postfix",
      location: ROOT,
      callback: () => new HTTPResult(FORBIDDEN, "Denied"),
    });
    await assert.rejects(read(allowed), HTTPResult);
  });

  it("rejects a route ID that does not match the selected pathname", async () => {
    const routeId = register();
    register({ location: `${ROOT}/other` });
    await assert.rejects(
      read(routeId, parentContext(), `${ROOT}/other`),
      HTTPResult,
    );
  });

  it("rejects stale registrations and non-GET targets", async () => {
    const routeId = register();
    routesProxy.unregister(routeId);
    await assert.rejects(read(routeId), HTTPResult);
    await assert.rejects(read(register({ method: "post" })), HTTPResult);
  });

  it("rejects origins, query options, fragments and normalized paths", async () => {
    const routeId = register();
    for (const path of [
      "https://other.test/read",
      "//other.test/read",
      `${RECORD_PATH}?bypass=true`,
      `${RECORD_PATH}#fragment`,
      `${ROOT}/x/../records/record-a`,
    ]) {
      await assert.rejects(read(routeId, parentContext(), path), HTTPResult);
    }
  });
});
