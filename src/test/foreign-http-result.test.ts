import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";

import type { HTTPResult } from "@antelopejs/interface-api";

import { isAddressInfo } from "../port-binding";
import { registerHandler, requestListener, unregisterHandler } from "../server";

function loadForeignHTTPResult(): typeof HTTPResult {
  const entry = require.resolve("@antelopejs/interface-api");
  const path = join(dirname(entry), "http-result.js");
  delete require.cache[path];
  // SAFETY: http-result.js exports the HTTPResult class this module types it as.
  return (require(path) as { HTTPResult: typeof HTTPResult }).HTTPResult;
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
    const Foreign = loadForeignHTTPResult();
    registerHandler(
      "foreign-result",
      { mode: "handler", method: "GET", location: "/foreign" },
      () => new Foreign(418, "teapot"),
    );

    const response = await fetch(`${baseUrl}/foreign`);

    assert.strictEqual(response.status, 418);
    assert.strictEqual(await response.text(), "teapot");
  });
});
