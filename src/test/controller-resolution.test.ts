import assert from "node:assert";
import { createServer, type Server } from "node:http";
import {
  type ComputedParameter,
  ControllerMeta,
  type RouteHandler,
} from "@antelopejs/interface-api";
import { GetMetadata } from "@antelopejs/interface-core";
import { internal, routesProxy } from "../implementations/api";
import { requestListener } from "../server";

const TEST_HOST = "127.0.0.1";
const TEST_ORIGIN = `http://${TEST_HOST}`;

interface TestController {
  requestId?: string;
  sequence: number;
}

interface TestResponse {
  status: number;
  body: string;
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

  function register(handler: RouteHandler): void {
    const id = `controller-resolution-${nextRouteId++}`;
    routeIds.push(id);
    routesProxy.register(id, handler);
  }

  before(async () => {
    server = createServer((request, response) => {
      void requestListener(request, response, "http");
    });
    port = await listen(server);
  });

  after(async () => {
    routeIds.forEach((id) => {
      routesProxy.unregister(id);
    });
    await close(server);
  });

  it("exposes the route proxy through the nested interface contract", () => {
    assert.equal(internal.routesProxy, routesProxy);
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
