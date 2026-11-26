import assert from "node:assert";
import { createServer, type Server } from "node:http";

import { HTTPResult, IsHTTPResult } from "@antelopejs/interface-api";

import { isAddressInfo } from "../port-binding";
import { registerHandler, requestListener, unregisterHandler } from "../server";

function foreignResult(status: number, body: string): HTTPResult {
  const foreignPrototype = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(HTTPResult.prototype),
  );
  const result: unknown = Object.setPrototypeOf(
    new HTTPResult(status, body),
    foreignPrototype,
  );
  assert.strictEqual(Object.getPrototypeOf(result), foreignPrototype);
  assert.ok(IsHTTPResult(result));
  return result;
}

describe("HTTPResult from another interface-api copy", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createServer((req, res) => void requestListener(req, res, "http"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(isAddressInfo(address));
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    unregisterHandler("foreign-result");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers with the status and body of a foreign result instead of a 200 JSON dump", async () => {
    registerHandler(
      "foreign-result",
      { mode: "handler", method: "GET", location: "/foreign" },
      () => foreignResult(418, "teapot"),
    );

    const response = await fetch(`${baseUrl}/foreign`);

    assert.strictEqual(response.status, 418);
    assert.strictEqual(await response.text(), "teapot");
  });
});
