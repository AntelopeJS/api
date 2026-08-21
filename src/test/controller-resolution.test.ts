import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import {
  type ComputedParameter,
  ControllerMeta,
  type RouteHandler,
} from "@antelopejs/interface-api";
import { GetMetadata } from "@antelopejs/interface-core";
import { routesProxy } from "../implementations/api";
import { requestListener } from "../server";

const TEST_HOST = "127.0.0.1";
const TEST_ORIGIN = `http://${TEST_HOST}`;
const THEN_PROPERTY = ["th", "en"].join("");

interface TestController {
  requestId?: string;
  sequence: number;
}

interface TestResponse {
  status: number;
  body: string;
}

interface StatefulThenable {
  readCount: () => number;
  value: PromiseLike<string>;
}

type ControllerConstructor = (new () => TestController) & {
  location: string;
};

function computedParameter(
  provider: ComputedParameter["provider"],
  modifiers: ComputedParameter["modifiers"] = [],
): ComputedParameter {
  return { provider, modifiers };
}

function createController(): ControllerConstructor {
  return class {
    static location = "";
    sequence = 0;
  };
}

function statefulThenable(value: string): StatefulThenable {
  let reads = 0;
  const thenable = Object.create(null);
  Object.defineProperty(thenable, THEN_PROPERTY, {
    get: () => {
      reads += 1;
      if (reads > 1) {
        throw new Error("then getter read more than once");
      }
      return (resolve: (resolved: string) => unknown) => resolve(value);
    },
  });
  return { readCount: () => reads, value: thenable };
}

function createHandler(
  Controller: ControllerConstructor,
  callback: RouteHandler["callback"],
  location: string,
  parameters: RouteHandler["parameters"] = [],
  properties: RouteHandler["properties"] = {},
  mode: RouteHandler["mode"] = "handler",
): RouteHandler {
  return {
    mode,
    method: "get",
    location,
    callback,
    parameters,
    properties,
    proto: Controller.prototype,
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, TEST_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to resolve test server port");
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

async function get(
  port: number,
  path: string,
  requestId?: string,
): Promise<TestResponse> {
  const response = await fetch(`${TEST_ORIGIN}:${port}${path}`, {
    headers: requestId ? { "x-request-id": requestId } : undefined,
  });
  return { status: response.status, body: await response.text() };
}

describe("Controller resolution", () => {
  const routeIds: string[] = [];
  let server: Server;
  let port: number;
  let nextRouteId = 0;
  let listenerResult: unknown;

  function register(handler: RouteHandler): void {
    const id = `controller-resolution-${nextRouteId++}`;
    routeIds.push(id);
    routesProxy.register(id, handler);
  }

  before(async () => {
    server = createServer((request, response) => {
      listenerResult = requestListener(request, response, "http");
    });
    port = await listen(server);
  });

  after(async () => {
    routeIds.forEach((id) => {
      routesProxy.unregister(id);
    });
    await close(server);
  });

  it("attaches the full implementation through the nested interface contract", () => {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `const { ImplementInterface } = require("@antelopejs/interface-core");
        ImplementInterface(
          require("@antelopejs/interface-api"),
          require("./dist/implementations/api"),
        );`,
      ],
      { cwd: resolve(__dirname, "../.."), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
  });

  it("isolates computed properties across concurrent requests", async () => {
    const Controller = createController();
    const properties = {
      requestId: computedParameter(
        (context) =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve(context.rawRequest.headers["x-request-id"]),
              1,
            );
          }),
      ),
    };
    register(
      createHandler(
        Controller,
        function (this: TestController) {
          this.sequence += 1;
          return `${this.requestId}:${this.sequence}`;
        },
        "/controller-resolution/isolation",
        [],
        properties,
      ),
    );

    const identifiers = Array.from(
      { length: 40 },
      (_, index) => `request-${index}`,
    );
    const responses = await Promise.all(
      identifiers.map((id) =>
        get(port, "/controller-resolution/isolation", id),
      ),
    );

    assert.deepEqual(
      responses.map((response) => response.body),
      identifiers.map((id) => `${id}:1`),
    );
  });

  it("reuses one controller within a request", async () => {
    const Controller = createController();
    const location = "/controller-resolution/reuse";
    register(
      createHandler(
        Controller,
        function (this: TestController) {
          this.sequence += 1;
        },
        location,
        [],
        {},
        "prefix",
      ),
    );
    register(
      createHandler(
        Controller,
        function (this: TestController) {
          this.sequence += 1;
          return this.sequence.toString();
        },
        location,
      ),
    );

    assert.deepEqual(await get(port, location), { status: 200, body: "2" });
    assert.deepEqual(await get(port, location), { status: 200, body: "2" });
  });

  it("applies inherited computed metadata", async () => {
    const Parent = createController();
    class Child extends Parent {}
    const parentMetadata = GetMetadata(Parent, ControllerMeta);
    parentMetadata.computed_props.requestId = computedParameter(
      (context) => context.rawRequest.headers["x-request-id"],
    );
    const childMetadata = GetMetadata(Child, ControllerMeta);
    const location = "/controller-resolution/inheritance";
    register(
      createHandler(
        Child,
        function (this: TestController) {
          return this.requestId;
        },
        location,
        [],
        childMetadata.computed_props,
      ),
    );

    assert.deepEqual(await get(port, location, "inherited"), {
      status: 200,
      body: "inherited",
    });
  });

  it("resolves computed values and handler parameters with controller this", async () => {
    const Controller = createController();
    const properties = {
      requestId: computedParameter(
        function (this: TestController, context) {
          this.sequence += 1;
          return context.rawRequest.headers["x-request-id"];
        },
        [
          async function (this: TestController, _context, value) {
            this.sequence += 1;
            return `${value}:computed`;
          },
        ],
      ),
    };
    const parameters = [
      computedParameter(function (this: TestController) {
        this.sequence += 1;
        return this.requestId;
      }),
      computedParameter(async function (this: TestController) {
        this.sequence += 1;
        return this.sequence;
      }),
      null,
    ];
    const location = "/controller-resolution/computed";
    register(
      createHandler(
        Controller,
        function (this: TestController, value, sequence, missing) {
          return `${value}:${sequence}:${missing}:${this.sequence}`;
        },
        location,
        parameters,
        properties,
      ),
    );

    assert.deepEqual(await get(port, location, "value"), {
      status: 200,
      body: "value:computed:4:undefined:4",
    });
  });

  it("keeps synchronous modifier chains on the synchronous request path", async () => {
    const Controller = createController();
    const location = "/controller-resolution/synchronous-modifiers";
    register(
      createHandler(
        Controller,
        function (this: TestController, value) {
          return `${value}:${this.sequence}`;
        },
        location,
        [
          computedParameter(
            function (this: TestController) {
              this.sequence += 1;
              return "provider";
            },
            [
              function (this: TestController, _context, value) {
                this.sequence += 1;
                return `${value}:first`;
              },
              function (this: TestController, _context, value) {
                this.sequence += 1;
                return `${value}:second`;
              },
            ],
          ),
        ],
      ),
    );

    assert.deepEqual(await get(port, location), {
      status: 200,
      body: "provider:first:second:3",
    });
    assert.equal(listenerResult, undefined);
  });

  it("continues remaining modifiers after the first asynchronous value", async () => {
    const Controller = createController();
    const events: string[] = [];
    const thenable = statefulThenable("value:thenable");
    const location = "/controller-resolution/mixed-modifiers";
    register(
      createHandler(Controller, (value) => value, location, [
        computedParameter(() => {
          events.push("provider");
          return thenable.value;
        }, [
          (_context, value) => {
            events.push("async");
            return Promise.resolve(`${value}:async`);
          },
          (_context, value) => {
            events.push("remaining");
            return `${value}:remaining`;
          },
        ]),
      ]),
    );

    assert.deepEqual(await get(port, location), {
      status: 200,
      body: "value:thenable:async:remaining",
    });
    assert.deepEqual(events, ["provider", "async", "remaining"]);
    assert.equal(thenable.readCount(), 1);
  });

  it("turns provider and modifier failures into request errors", async () => {
    const ProviderController = createController();
    const ModifierController = createController();
    register(
      createHandler(
        ProviderController,
        () => "unreachable",
        "/controller-resolution/provider-error",
        [computedParameter(() => Promise.reject(new Error("provider failed")))],
      ),
    );
    register(
      createHandler(
        ModifierController,
        () => "unreachable",
        "/controller-resolution/modifier-error",
        [
          computedParameter(
            () => "value",
            [
              () => {
                throw new Error("modifier failed");
              },
            ],
          ),
        ],
      ),
    );

    assert.deepEqual(await get(port, "/controller-resolution/provider-error"), {
      status: 500,
      body: "provider failed",
    });
    assert.deepEqual(await get(port, "/controller-resolution/modifier-error"), {
      status: 500,
      body: "modifier failed",
    });
  });
});
