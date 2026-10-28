import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { HandlerPriority } from "@antelopejs/interface-api";
import { Events } from "@antelopejs/interface-core/modules";

import { configure, getConfig } from "../index";
import { registerHandler, requestListener, unregisterHandler } from "../server";

const ALLOWED_ORIGIN = "https://app.example.com";
const HANDLER_ID = "startup-gate-handler";

const announceStarted = (): void => Events.ModulesStarted.emit();
const announceStopping = (): void => Events.ModulesStopping.emit();

before("every suite runs against a started project", announceStarted);

describe("Startup gate", () => {
  let server: Server;
  let baseUrl: string;
  let handlerCalls: number;
  let originalConfig: ReturnType<typeof getConfig>;

  before(async () => {
    originalConfig = getConfig();
    server = createServer((req, res) => void requestListener(req, res, "http"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!(address instanceof Object)) {
      throw new Error("Test server did not expose a TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    registerHandler(
      HANDLER_ID,
      "handler",
      "GET",
      "/gated",
      () => {
        handlerCalls += 1;
        return "served";
      },
      HandlerPriority.NORMAL,
    );
  });

  beforeEach(() => {
    handlerCalls = 0;
    announceStopping();
  });

  after(async () => {
    unregisterHandler(HANDLER_ID);
    configure(originalConfig);
    announceStarted();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers 503 with Retry-After and runs nothing until modules started", async () => {
    const response = await fetch(`${baseUrl}/gated`);

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "1");
    assert.equal(await response.text(), "error.server_starting");
    assert.equal(handlerCalls, 0);
  });

  it("opens once modules started and closes again when they stop", async () => {
    announceStarted();
    const opened = await fetch(`${baseUrl}/gated`);
    announceStopping();
    const closed = await fetch(`${baseUrl}/gated`);

    assert.equal(opened.status, 200);
    assert.equal(await opened.text(), "served");
    assert.equal(closed.status, 503);
    assert.equal(handlerCalls, 1);
  });

  it("answers the liveness path while closed", async () => {
    const response = await fetch(`${baseUrl}/_live`);

    assert.equal(response.status, 200);
  });

  it("lets a browser complete its preflight and read the 503", async () => {
    configure({ ...originalConfig, cors: { allowedOrigins: ALLOWED_ORIGIN } });

    const preflight = await fetch(`${baseUrl}/gated`, {
      method: "OPTIONS",
      headers: {
        origin: ALLOWED_ORIGIN,
        "access-control-request-method": "GET",
      },
    });
    const gated = await fetch(`${baseUrl}/gated`, {
      headers: { origin: ALLOWED_ORIGIN },
    });

    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      ALLOWED_ORIGIN,
    );
    assert.equal(gated.status, 503);
    assert.equal(
      gated.headers.get("access-control-allow-origin"),
      ALLOWED_ORIGIN,
    );
  });
});
