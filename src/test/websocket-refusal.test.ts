import assert from "node:assert";
import * as http from "node:http";
import { WebSocket } from "ws";
import { HandlerPriority, HTTPResult } from "@antelopejs/interface-api";
import { Events } from "@antelopejs/interface-core/modules";

import {
  type RouteCallback,
  registerHandler,
  unregisterHandler,
  upgradeListener,
} from "../server";
import { isAddressInfo } from "../port-binding";

const TEST_HOST = "127.0.0.1";
const SOCKET_PATH = "/refusal/socket";
const PREFIX_ID = "websocket-refusal-prefix";
const HANDLER_ID = "websocket-refusal-handler";

interface Refusal {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, TEST_HOST, () => {
      const address = server.address();
      if (!isAddressInfo(address)) {
        throw new Error("Expected an IP server address");
      }
      resolve(address.port);
    });
  });
}

function readBody(response: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      body += chunk;
    });
    response.on("end", () => resolve(body));
    response.on("error", reject);
  });
}

function socketClosed(response: http.IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    if (response.socket.closed) {
      resolve();
      return;
    }
    response.socket.once("close", () => resolve());
  });
}

function openRefused(port: number, path: string): Promise<Refusal> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${TEST_HOST}:${port}${path}`);
    socket.on("open", () => {
      socket.close();
      reject(new Error("The upgrade was accepted"));
    });
    socket.on("unexpected-response", (_request, response) => {
      Promise.all([readBody(response), socketClosed(response)]).then(
        ([body]) =>
          resolve({
            status: response.statusCode ?? 0,
            body,
            headers: response.headers,
          }),
        reject,
      );
    });
    socket.on("error", reject);
  });
}

function registerSocket(prefix: RouteCallback): void {
  registerHandler(
    PREFIX_ID,
    {
      mode: "prefix",
      method: "GET",
      location: SOCKET_PATH,
      priority: HandlerPriority.NORMAL,
    },
    prefix,
  );
  registerHandler(
    HANDLER_ID,
    {
      mode: "websocket",
      method: "GET",
      location: SOCKET_PATH,
      priority: HandlerPriority.NORMAL,
    },
    () => undefined,
  );
}

describe("WebSocket upgrade refusal", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    Events.ModulesStarted.emit();
    server = http.createServer();
    server.on("upgrade", (request, socket, head) => {
      void upgradeListener(request, socket, head, "ws");
    });
    port = await listen(server);
  });

  afterEach(async () => {
    unregisterHandler(PREFIX_ID);
    unregisterHandler(HANDLER_ID);
    Events.ModulesStarted.emit();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers the HTTPResult a prefix returns", async () => {
    registerSocket(() => new HTTPResult(403, "private"));

    const refusal = await openRefused(port, SOCKET_PATH);

    assert.equal(refusal.status, 403);
    assert.equal(refusal.body, "private");
  });

  it("answers 500 with the message of an error a prefix throws", async () => {
    registerSocket(() => {
      throw new Error("prefix failed");
    });

    const refusal = await openRefused(port, SOCKET_PATH);

    assert.equal(refusal.status, 500);
    assert.equal(refusal.body, "prefix failed");
  });

  it("answers 404 when no WebSocket handler matches", async () => {
    const refusal = await openRefused(port, "/refusal/missing");

    assert.equal(refusal.status, 404);
    assert.equal(refusal.body, "Not Found");
  });

  it("answers the startup gate 503 while modules are stopping", async () => {
    registerSocket(() => undefined);
    Events.ModulesStopping.emit();

    const refusal = await openRefused(port, SOCKET_PATH);

    assert.equal(refusal.status, 503);
    assert.equal(refusal.headers["retry-after"], "1");
    assert.equal(refusal.body, "error.server_starting");
  });
});
