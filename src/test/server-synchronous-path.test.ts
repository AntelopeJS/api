import assert from "node:assert";
import { execFile } from "node:child_process";
import * as http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { HandlerPriority, HTTPResult } from "@antelopejs/interface-api";
import { WebSocket } from "ws";
import {
  type RequestContext,
  registerHandler,
  requestListener,
  unregisterHandler,
  upgradeListener,
} from "../server";

const TEST_HOST = "127.0.0.1";
const SUCCESS_STATUS = 200;
const SERVER_ERROR_STATUS = 500;
const THEN_PROPERTY = ["th", "en"].join("");
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

function immediateThenable<T>(value: T): PromiseLike<T> {
  const thenable = Object.create(null);
  Object.defineProperty(thenable, THEN_PROPERTY, {
    value: (resolve: (resolved: T) => unknown) => resolve(value),
  });
  return thenable as PromiseLike<T>;
}

function rejectedThenable(error: unknown): PromiseLike<never> {
  const thenable = Object.create(null);
  Object.defineProperty(thenable, THEN_PROPERTY, {
    value: (_resolve: unknown, reject: (reason: unknown) => unknown) =>
      reject(error),
  });
  return thenable as PromiseLike<never>;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, TEST_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
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
    'api.registerHandler("p", "prefix", "GET", "/", () => undefined);',
    'api.registerHandler("h", "handler", "GET", "/", () => "ok");',
    'api.registerHandler("x", "postfix", "GET", "/", () => undefined);',
    'api.registerHandler("m", "monitor", "GET", "/", () => undefined);',
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

describe("Synchronous HTTP request path", () => {
  const routeIds: string[] = [];
  let server: http.Server;
  let port: number;
  let listenerResult: unknown;

  function register(
    id: string,
    mode: "prefix" | "postfix" | "handler" | "monitor" | "websocket",
    method: string | undefined,
    location: string,
    callback: (context: RequestContext) => unknown,
    priority = HandlerPriority.NORMAL,
  ): void {
    routeIds.push(id);
    registerHandler(id, mode, method, location, callback, priority);
  }

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

  it("completes synchronous callbacks in request order", async () => {
    const order: string[] = [];
    register("sync-prefix", "prefix", "GET", "/sync", () => {
      order.push("prefix");
    });
    register("sync-handler", "handler", "GET", "/sync", () => {
      order.push("handler");
      return "ok";
    });
    register("sync-postfix", "postfix", "GET", "/sync", () => {
      order.push("postfix");
    });
    register("sync-monitor", "monitor", "GET", "/sync", () => {
      order.push("monitor");
    });

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
    register("async-prefix", "prefix", "GET", "/async", () =>
      Promise.resolve().then(() => {
        order.push("prefix");
      }),
    );
    register("thenable-handler", "handler", "GET", "/async", () => {
      order.push("handler");
      return immediateThenable("async-ok");
    });
    register("thenable-postfix", "postfix", "GET", "/async", () => {
      order.push("postfix");
      return immediateThenable(undefined);
    });
    register("async-monitor", "monitor", "GET", "/async", () =>
      Promise.resolve().then(() => order.push("monitor")),
    );

    const response = await sendRequest(port, { path: "/async" });

    assert.equal(response.body, "async-ok");
    assert.ok(listenerResult instanceof Promise);
    assert.deepEqual(order, ["prefix", "handler", "postfix", "monitor"]);
  });

  it("preserves priorities, dynamic parameters, and early responses", async () => {
    const order: string[] = [];
    register(
      "priority-low",
      "prefix",
      "GET",
      "/priority/:id",
      () => order.push("low"),
      HandlerPriority.LOW,
    );
    register(
      "priority-high",
      "prefix",
      "GET",
      "/priority/:id",
      (context) => {
        order.push(`high:${context.routeParameters.id}`);
        return new HTTPResult(202, "early");
      },
      HandlerPriority.HIGH,
    );
    register("skipped-handler", "handler", "GET", "/priority/:id", () => {
      order.push("handler");
    });
    register("early-monitor", "monitor", "GET", "/priority/:id", () => {
      order.push("monitor");
    });

    const response = await sendRequest(port, { path: "/priority/42" });

    assert.equal(response.status, 202);
    assert.equal(response.body, "early");
    assert.deepEqual(order, ["high:42", "monitor"]);
  });

  it("turns synchronous throws and asynchronous rejections into errors", async () => {
    const errors: unknown[] = [];
    register("throw-handler", "handler", "GET", "/throw", () => {
      throw new Error("sync failure");
    });
    register("throw-monitor", "monitor", "GET", "/throw", (context) => {
      errors.push(context.error);
    });
    register("reject-handler", "handler", "GET", "/reject", () =>
      Promise.reject(new Error("async failure")),
    );
    register("reject-monitor", "monitor", "GET", "/reject", (context) => {
      errors.push(context.error);
    });
    register("thenable-reject", "handler", "GET", "/thenable-reject", () =>
      rejectedThenable(new Error("thenable failure")),
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
    assert.equal((errors[0] as Error).message, "sync failure");
    assert.equal((errors[1] as Error).message, "async failure");
  });

  it("isolates monitor failures and continues remaining monitors", async () => {
    const order: string[] = [];
    const originalConsoleError = console.error;
    console.error = () => undefined;
    register("monitor-handler", "handler", "GET", "/monitors", () => "ok");
    register(
      "monitor-throw",
      "monitor",
      "GET",
      "/monitors",
      () => {
        order.push("throw");
        throw new Error("ignored");
      },
      HandlerPriority.HIGH,
    );
    register(
      "monitor-reject",
      "monitor",
      "GET",
      "/monitors",
      () => {
        order.push("reject");
        return Promise.reject(new Error("ignored"));
      },
      HandlerPriority.NORMAL,
    );
    register(
      "monitor-final",
      "monitor",
      "GET",
      "/monitors",
      () => order.push("final"),
      HandlerPriority.LOW,
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
    register("head-get", "handler", "GET", "/head", () => "head-body");
    register(
      "options-prefix",
      "prefix",
      "OPTIONS",
      "/options",
      () => new HTTPResult(204, null),
    );
    register("reload-first", "handler", "GET", "/reload", () => "first");

    const head = await sendRequest(port, { method: "HEAD", path: "/head" });
    const options = await sendRequest(port, {
      method: "OPTIONS",
      path: "/options",
    });
    const first = await sendRequest(port, { path: "/reload" });
    unregisterHandler("reload-first");
    register("reload-second", "handler", "GET", "/reload", () => "second");
    const second = await sendRequest(port, { path: "/reload" });

    assert.equal(head.status, SUCCESS_STATUS);
    assert.equal(head.body, "");
    assert.equal(options.status, 204);
    assert.equal(first.body, "first");
    assert.equal(second.body, "second");
  });

  it("keeps stream responses intact", async () => {
    register("stream-handler", "handler", "GET", "/stream", (context) => {
      const output = context.response.getWriteStream("text/plain");
      output.end("streamed");
      return "replacement";
    });

    const response = await sendRequest(port, { path: "/stream" });

    assert.equal(response.status, SUCCESS_STATUS);
    assert.equal(response.body, "streamed");
  });

  it("does not alter WebSocket prefix, handler, and monitor ordering", async () => {
    const order: string[] = [];
    register("ws-prefix", "prefix", "GET", "/socket", () => {
      order.push("prefix");
    });
    register("ws-handler", "websocket", "GET", "/socket", (context) => {
      order.push("handler");
      (context.connection as WebSocket).send("connected");
    });
    register("ws-monitor", "monitor", "GET", "/socket", () => {
      order.push("monitor");
    });

    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://${TEST_HOST}:${port}/socket`);
      socket.on("message", (data) => {
        resolve(data.toString());
        socket.close();
      });
      socket.on("error", reject);
    });

    assert.equal(message, "connected");
    assert.deepEqual(order, ["prefix", "handler", "monitor"]);
  });
});
