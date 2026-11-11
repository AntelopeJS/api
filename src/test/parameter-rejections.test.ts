import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { GetMetadata } from "@antelopejs/interface-core";
import {
  type ComputedParameter,
  Controller as ControllerBase,
  ControllerMeta,
  DEFAULT_REQUEST_BODY_LIMIT,
  JSONBody,
  type RouteHandler,
} from "@antelopejs/interface-api";

import { requestListener } from "../server";
import { routesProxy } from "../implementations/api";
import { isAddressInfo } from "../port-binding";

const TEST_HOST = "127.0.0.1";
const OVERSIZED_BODY = JSON.stringify("x".repeat(DEFAULT_REQUEST_BODY_LIMIT));

const routeIds: string[] = [];
let server: Server;
let port: number;

function listen(target: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    target.once("error", reject);
    target.listen(0, TEST_HOST, () => {
      const address = target.address();
      if (!isAddressInfo(address)) {
        reject(new Error("Test server did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(target: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    target.close((error) => (error ? reject(error) : resolve()));
  });
}

function jsonBodyParameter(): ComputedParameter {
  class Controller extends ControllerBase("") {
    handle(@JSONBody() body: unknown) {
      return body;
    }
  }
  return GetMetadata(Controller, ControllerMeta).computed_params.handle[0];
}

function throwingParameter(): ComputedParameter {
  return {
    provider: () => {
      throw new Error("later parameter failed");
    },
    modifiers: [],
  };
}

function recordingParameter(calls: string[]): ComputedParameter {
  return {
    provider: () => {
      calls.push("resolved after the throw");
      return "unused";
    },
    modifiers: [],
  };
}

function register(
  location: string,
  parameters: RouteHandler["parameters"],
  properties: RouteHandler["properties"] = {},
  controller: RouteHandler["controller"] = class extends ControllerBase("") {},
): void {
  const id = `parameter-rejections-${routeIds.length}`;
  routeIds.push(id);
  routesProxy.register(id, {
    mode: "handler",
    method: "post",
    location,
    callback: () => "unreachable",
    parameters,
    properties,
    controller,
  });
}

async function postOversized(location: string, laterCalls: string[]) {
  const unhandled: unknown[] = [];
  const record: NodeJS.UnhandledRejectionListener = (reason) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", record);
  try {
    const response = await fetch(`http://${TEST_HOST}:${port}${location}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: OVERSIZED_BODY,
    });
    const answer = { status: response.status, body: await response.text() };
    await new Promise(setImmediate);
    return { ...answer, unhandled, laterCalls };
  } finally {
    process.off("unhandledRejection", record);
  }
}

describe("Parameter rejections", () => {
  before(async () => {
    server = createServer((request, response) => {
      void requestListener(request, response, "http");
    });
    port = await listen(server);
  });

  after(async () => {
    routeIds.forEach((id) => routesProxy.unregister(id));
    await close(server);
  });

  it("handles a started body read when a later parameter throws", async () => {
    const laterCalls: string[] = [];
    register("/parameter-rejections/parameters", [
      jsonBodyParameter(),
      throwingParameter(),
      recordingParameter(laterCalls),
    ]);

    assert.deepEqual(
      await postOversized("/parameter-rejections/parameters", laterCalls),
      {
        status: 500,
        body: "later parameter failed",
        unhandled: [],
        laterCalls: [],
      },
    );
  });

  it("handles a started body read when a later computed property throws", async () => {
    const laterCalls: string[] = [];
    register("/parameter-rejections/properties", [], {
      body: jsonBodyParameter(),
      failing: throwingParameter(),
      later: recordingParameter(laterCalls),
    });

    assert.deepEqual(
      await postOversized("/parameter-rejections/properties", laterCalls),
      {
        status: 500,
        body: "later parameter failed",
        unhandled: [],
        laterCalls: [],
      },
    );
  });

  it("handles a started body read when assigning a later computed property throws", async () => {
    const laterCalls: string[] = [];
    register(
      "/parameter-rejections/assignment",
      [],
      {
        body: jsonBodyParameter(),
        locked: { provider: () => "value", modifiers: [] },
        later: recordingParameter(laterCalls),
      },
      class extends ControllerBase("") {
        get locked() {
          return "read only";
        }
      },
    );

    const answer = await postOversized(
      "/parameter-rejections/assignment",
      laterCalls,
    );
    assert.deepEqual(
      { ...answer, body: undefined },
      { status: 500, body: undefined, unhandled: [], laterCalls: [] },
    );
    assert.match(answer.body, /locked/);
  });
});
