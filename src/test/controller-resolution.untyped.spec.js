import assert from "node:assert";

import { routesProxy } from "../implementations/api";

describe("Controller resolution, untyped input", () => {
  it("refuses a handler without a controller at registration", () => {
    const location = "/controller-resolution/no-controller";
    const handler = {
      mode: "handler",
      method: "get",
      location,
      callback: () => "unused",
      parameters: [],
      properties: {},
    };

    assert.throws(
      () => routesProxy.register("controller-resolution-refused", handler),
      (error) =>
        error instanceof TypeError &&
        error.message.includes("GET") &&
        error.message.includes(location) &&
        error.message.includes("controller"),
    );

    assert.equal(
      routesProxy.getRoutes().some((route) => route.uri === location),
      false,
    );
  });
});
