import path from "node:path";
import { WebSocket } from "ws";
import assert from "node:assert";
import * as http from "node:http";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { HandlerPriority, HTTPResult } from "@antelopejs/interface-api";

import {
  type RouteCallback,
  registerHandler,
  requestListener,
  unregisterHandler,
  upgradeListener,
} from "../server";
import type { RouteDefinition } from "../route-table";
import { nullPrototypeThenable } from "./thenable";

const TEST_HOST = "127.0.0.1";
const SUCCESS_STATUS = 200;
const SERVER_ERROR_STATUS = 500;
const execFileAsync = promisify(execFile);

interface TestResponse {
  body: string;
  headers: http.IncomingHttpHeaders;
  status: number;
}

interface RequestOptions {
  method?: string;
  path?: string;
}

interface StatefulThenable {
  getReadCount: () => number;
  value: object;
}

function immediateThenable(): object {
  return nullPrototypeThenable({
    value: (resolve: (resolved: undefined) => void) => resolve(undefined),
  });
}

function rejectedThenable(error: Error): object {
  return nullPrototypeThenable({
    value: (
      _resolve: (resolved: never) => void,
      reject: (reason: Error) => void,
    ) => reject(error),
  });
}

function statefulThenable(value: string): StatefulThenable {
  let readCount = 0;
  const thenable = nullPrototypeThenable({
    get: () => {
      readCount += 1;
      if (readCount > 1) {
        throw new Error("then getter read more than once");
      }
      return (resolve: (resolved: string) => void) => resolve(value);
    },
  });
  return {
    getReadCount: () => readCount,
    value: thenable,
  };
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, TEST_HOST, () => {
      const address = server.address();
      if (!(address instanceof Object)) {
        throw new Error("Expected an IP server address");
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function sendRequest(
  port: number,
  options: RequestOptions = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: TEST_HOST,
        port,
        method: options.method ?? "GET",
        path: options.path ?? "/sync",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString(),
            headers: response.headers,
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function getIsolatedListenerResult(): Promise<string> {
  const serverPath = path.resolve(__dirname, "../server.js");
  const script = [
    'const http = require("node:http");',
    "const api = require(process.argv[1]);",
    'api.registerHandler("p", { mode: "prefix", method: "GET", location: "/" }, () => undefined);',
    'api.registerHandler("h", { mode: "handler", method: "GET", location: "/" }, () => "ok");',
    'api.registerHandler("x", { mode: "postfix", method: "GET", location: "/" }, () => undefined);',
    'api.registerHandler("m", { mode: "monitor", method: "GET", location: "/" }, () => undefined);',
    "let result;",
    'const server = http.createServer((req, res) => { result = api.requestListener(req, res, "http"); });',
    'server.listen(0, "127.0.0.1", () => {',
    "  const port = server.address().port;",
    '  http.get({ host: "127.0.0.1", port }, (res) => {',
    '    res.resume().on("end", () => server.close(() => process.stdout.write(String(result))));',
    "  });",
    "});",
  ].join("\n");
  const { stdout } = await execFileAsync(process.execPath, [
    "-e",
    script,
    serverPath,
  ]);
  return stdout;
}

const routeIds: string[] = [];

let server: http.Server;

let port: number;

let listenerResult: unknown;

function register(
  id: string,
  route: RouteDefinition,
  callback: RouteCallback,
): void {
  routeIds.push(id);
  registerHandler(id, route, callback);
}

function synchronousOrderCases(): void {
  it("completes synchronous callbacks in request order", async () => {
    const order: string[] = [];
    register(
      "sync-prefix",
      { mode: "prefix", method: "GET", location: "/sync" },
      () => {
        order.push("prefix");
      },
    );
    register(
      "sync-handler",
      { mode: "handler", method: "GET", location: "/sync" },
      () => {
        order.push("handler");
        return "ok";
      },
    );
    register(
      "sync-postfix",
      { mode: "postfix", method: "GET", location: "/sync" },
      () => {
        order.push("postfix");
      },
    );
    register(
      "sync-monitor",
      { mode: "monitor", method: "GET", location: "/sync" },
      () => {
        order.push("monitor");
      },
    );

    const response = await sendRequest(port);

    assert.equal(response.status, SUCCESS_STATUS);
    assert.equal(response.body, "ok");
    assert.deepEqual(order, ["prefix", "handler", "postfix", "monitor"]);
  });

  it("returns no awaitable for an isolated synchronous stack", async () => {
    assert.equal(await getIsolatedListenerResult(), "undefined");
  });

  it("continues in order when each phase returns a promise or thenable", async () => {
    const order: string[] = [];
    const handlerResult = statefulThenable("async-ok");
    register(
      "async-prefix",
      { mode: "prefix", method: "GET", location: "/async" },
      () =>
        Promise.resolve().then(() => {
          order.push("prefix");
        }),
    );
    register(
      "thenable-handler",
      { mode: "handler", method: "GET", location: "/async" },
      // @ts-expect-error off-contract result: a null-prototype thenable typed `object`; the test asserts its value is answered and its `then` read once
      () => {
        order.push("handler");
        return handlerResult.value;
      },
    );
    register(
      "thenable-postfix",
      { mode: "postfix", method: "GET", location: "/async" },
      // @ts-expect-error off-contract result: a null-prototype thenable typed `object`; the test asserts the postfix waits for it before the monitor runs
      () => {
        order.push("postfix");
        return immediateThenable();
      },
    );
    register(
      "async-monitor",
      { mode: "monitor", method: "GET", location: "/async" },
      () => Promise.resolve().then(() => order.push("monitor")),
    );

    const response = await sendRequest(port, { path: "/async" });

    assert.equal(response.body, "async-ok");
    assert.ok(listenerResult instanceof Promise);
    assert.equal(handlerResult.getReadCount(), 1);
    assert.deepEqual(order, ["prefix", "handler", "postfix", "monitor"]);
  });
}

function priorityAndErrorCases(): void {
  it("preserves priorities, dynamic parameters, and early responses", async () => {
    const order: string[] = [];
    register(
      "priority-low",
      {
        mode: "prefix",
        method: "GET",
        location: "/priority/:id",
        priority: HandlerPriority.LOW,
      },
      () => order.push("low"),
    );
    register(
      "priority-high",
      {
        mode: "prefix",
        method: "GET",
        location: "/priority/:id",
        priority: HandlerPriority.HIGH,
      },
      (context) => {
        order.push(`high:${context.routeParameters.id}`);
        return new HTTPResult(202, "early");
      },
    );
    register(
      "skipped-handler",
      { mode: "handler", method: "GET", location: "/priority/:id" },
      () => {
        order.push("handler");
      },
    );
    register(
      "early-monitor",
      { mode: "monitor", method: "GET", location: "/priority/:id" },
      () => {
        order.push("monitor");
      },
    );

    const response = await sendRequest(port, { path: "/priority/42" });

    assert.equal(response.status, 202);
    assert.equal(response.body, "early");
    assert.deepEqual(order, ["high:42", "monitor"]);
  });

  it("turns synchronous throws and asynchronous rejections into errors", async () => {
    const errors: unknown[] = [];
    register(
      "throw-handler",
      { mode: "handler", method: "GET", location: "/throw" },
      () => {
        throw new Error("sync failure");
      },
    );
    register(
      "throw-monitor",
      { mode: "monitor", method: "GET", location: "/throw" },
      (context) => {
        errors.push(context.error);
      },
    );
    register(
      "reject-handler",
      { mode: "handler", method: "GET", location: "/reject" },
      () => Promise.reject(new Error("async failure")),
    );
    register(
      "reject-monitor",
      { mode: "monitor", method: "GET", location: "/reject" },
      (context) => {
        errors.push(context.error);
      },
    );
    register(
      "thenable-reject",
      { mode: "handler", method: "GET", location: "/thenable-reject" },
      // @ts-expect-error off-contract result: a null-prototype thenable typed `object` that rejects; the test asserts a 500 with the rejection message
      () => rejectedThenable(new Error("thenable failure")),
    );

    const thrown = await sendRequest(port, { path: "/throw" });
    const rejected = await sendRequest(port, { path: "/reject" });
    const thenable = await sendRequest(port, { path: "/thenable-reject" });

    assert.equal(thrown.status, SERVER_ERROR_STATUS);
    assert.equal(thrown.body, "sync failure");
    assert.equal(rejected.status, SERVER_ERROR_STATUS);
    assert.equal(rejected.body, "async failure");
    assert.equal(thenable.status, SERVER_ERROR_STATUS);
    assert.equal(thenable.body, "thenable failure");
    const [syncError, asyncError] = errors;
    assert.ok(syncError instanceof Error);
    assert.equal(syncError.message, "sync failure");
    assert.ok(asyncError instanceof Error);
    assert.equal(asyncError.message, "async failure");
  });
}

function monitorAndDispatchCases(): void {
  it("isolates monitor failures and continues remaining monitors", async () => {
    const order: string[] = [];
    const originalConsoleError = console.error;
    console.error = () => undefined;
    register(
      "monitor-handler",
      { mode: "handler", method: "GET", location: "/monitors" },
      () => "ok",
    );
    register(
      "monitor-throw",
      {
        mode: "monitor",
        method: "GET",
        location: "/monitors",
        priority: HandlerPriority.HIGH,
      },
      () => {
        order.push("throw");
        throw new Error("ignored");
      },
    );
    register(
      "monitor-reject",
      {
        mode: "monitor",
        method: "GET",
        location: "/monitors",
        priority: HandlerPriority.NORMAL,
      },
      () => {
        order.push("reject");
        return Promise.reject(new Error("ignored"));
      },
    );
    register(
      "monitor-final",
      {
        mode: "monitor",
        method: "GET",
        location: "/monitors",
        priority: HandlerPriority.LOW,
      },
      () => order.push("final"),
    );

    try {
      const response = await sendRequest(port, { path: "/monitors" });
      assert.equal(response.body, "ok");
      assert.deepEqual(order, ["throw", "reject", "final"]);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("preserves HEAD fallback, OPTIONS handling, and hot reload", async () => {
    register(
      "head-get",
      { mode: "handler", method: "GET", location: "/head" },
      () => "head-body",
    );
    register(
      "options-prefix",
      { mode: "prefix", method: "OPTIONS", location: "/options" },
      () => new HTTPResult(204, null),
    );
    register(
      "reload-first",
      { mode: "handler", method: "GET", location: "/reload" },
      () => "first",
    );

    const head = await sendRequest(port, { method: "HEAD", path: "/head" });
    const options = await sendRequest(port, {
      method: "OPTIONS",
      path: "/options",
    });
    const first = await sendRequest(port, { path: "/reload" });
    unregisterHandler("reload-first");
    register(
      "reload-second",
      { mode: "handler", method: "GET", location: "/reload" },
      () => "second",
    );
    const second = await sendRequest(port, { path: "/reload" });

    assert.equal(head.status, SUCCESS_STATUS);
    assert.equal(head.body, "");
    assert.equal(options.status, 204);
    assert.equal(first.body, "first");
    assert.equal(second.body, "second");
  });

  it("keeps stream responses intact", async () => {
    register(
      "stream-handler",
      { mode: "handler", method: "GET", location: "/stream" },
      (context) => {
        const output = context.response.getWriteStream("text/plain");
        output.end("streamed");
        return "replacement";
      },
    );

    const response = await sendRequest(port, { path: "/stream" });

    assert.equal(response.status, SUCCESS_STATUS);
    assert.equal(response.body, "streamed");
  });
}

function websocketCases(): void {
  it("does not alter WebSocket prefix, handler, and monitor ordering", async () => {
    const order: string[] = [];
    register(
      "ws-prefix",
      { mode: "prefix", method: "GET", location: "/socket" },
      () => {
        order.push("prefix");
      },
    );
    register(
      "ws-handler",
      { mode: "websocket", method: "GET", location: "/socket" },
      (context) => {
        order.push("handler");
        assert.ok(context.connection);
        context.connection.send("connected");
      },
    );
    register(
      "ws-monitor",
      { mode: "monitor", method: "GET", location: "/socket" },
      () => {
        order.push("monitor");
      },
    );

    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://${TEST_HOST}:${port}/socket`);
      socket.on("message", (data: Buffer) => {
        resolve(data.toString());
        socket.close();
      });
      socket.on("error", reject);
    });

    assert.equal(message, "connected");
    assert.deepEqual(order, ["prefix", "handler", "monitor"]);
  });
}

describe("Synchronous HTTP request path", () => {
  beforeEach(async () => {
    listenerResult = undefined;
    server = http.createServer((request, response) => {
      listenerResult = requestListener(request, response, "http");
    });
    server.on("upgrade", (request, socket, head) => {
      void upgradeListener(request, socket, head, "ws");
    });
    port = await listen(server);
  });

  afterEach(async () => {
    for (const id of routeIds.splice(0)) {
      unregisterHandler(id);
    }
    await close(server);
  });

  synchronousOrderCases();
  priorityAndErrorCases();
  monitorAndDispatchCases();
  websocketCases();
});
