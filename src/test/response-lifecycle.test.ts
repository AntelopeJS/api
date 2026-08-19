import assert from "node:assert";
import * as http from "node:http";
import { HandlerPriority, HTTPResult } from "@antelopejs/interface-api";
import {
  type RequestContext,
  registerHandler,
  requestListener,
  unregisterHandler,
} from "../server";

const HOST = "127.0.0.1";
const ROUTE_ROOT = "/response-lifecycle";
const registeredHandlers: string[] = [];

interface CapturedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function register(
  mode: "prefix" | "postfix" | "handler" | "monitor",
  path: string,
  callback: (context: RequestContext) => unknown,
) {
  const id = `${mode}-${path}-${registeredHandlers.length}`;
  registeredHandlers.push(id);
  registerHandler(id, mode, "get", path, callback, HandlerPriority.NORMAL);
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request(port: number, path: string, method = "GET") {
  return new Promise<CapturedResponse>((resolve, reject) => {
    const req = http.request({ host: HOST, port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.once("error", reject);
    req.end();
  });
}

describe("HTTP response lifecycle", () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    server = http.createServer(
      (req, res) => void requestListener(req, res, "http"),
    );
    port = await listen(server);
  });

  after(async () => {
    for (const id of registeredHandlers) {
      unregisterHandler(id);
    }
    await close(server);
  });

  it("reuses the matched route response without observing headers", async () => {
    const path = `${ROUTE_ROOT}/common`;
    let contextResponse: HTTPResult | undefined;
    let initialStatus = 0;
    let initialBody: unknown;
    let headerReads = 0;
    const originalGetHeaders = HTTPResult.prototype.getHeaders;
    register("handler", path, (context) => {
      contextResponse = context.response;
      initialStatus = context.response.getStatus();
      initialBody = context.response.getBody();
      return { ok: true };
    });
    HTTPResult.prototype.getHeaders = function getHeaders() {
      headerReads += 1;
      return originalGetHeaders.call(this);
    };

    try {
      const response = await request(port, path);
      assert.equal(response.status, 200);
      assert.equal(response.body, '{"ok":true}');
      assert.equal(initialStatus, 200);
      assert.equal(initialBody, "");
      assert.equal(contextResponse?.getStatus(), 200);
      assert.equal(contextResponse?.getBody(), '{"ok":true}');
      assert.equal(headerReads, 0);
    } finally {
      HTTPResult.prototype.getHeaders = originalGetHeaders;
    }
  });

  it("uses peekHeaders when the installed interface exposes it", async () => {
    const path = `${ROUTE_ROOT}/peek-headers`;
    let headerReads = 0;
    const originalGetHeaders = HTTPResult.prototype.getHeaders;
    const hasPeekHeaders = "peekHeaders" in HTTPResult.prototype;
    register("handler", path, () => new HTTPResult(203, "result"));
    HTTPResult.prototype.getHeaders = function getHeaders() {
      headerReads += 1;
      return originalGetHeaders.call(this);
    };

    try {
      const response = await request(port, path);
      assert.equal(response.status, 203);
      assert.equal(response.body, "result");
      assert.equal(headerReads, hasPeekHeaders ? 0 : 1);
    } finally {
      HTTPResult.prototype.getHeaders = originalGetHeaders;
    }
  });

  it("preserves headers across prefix, handler, and postfix results", async () => {
    const path = `${ROUTE_ROOT}/headers`;
    register("prefix", path, ({ response }) =>
      response.addHeader("X-Prefix", "1"),
    );
    register("handler", path, ({ response }) => {
      response.addHeader("X-Handler", "2");
      return "handler";
    });
    register("postfix", path, () => {
      const response = new HTTPResult(202, "postfix");
      response.addHeader("X-Postfix", "3");
      return response;
    });

    const response = await request(port, path);
    assert.equal(response.status, 202);
    assert.equal(response.body, "postfix");
    assert.equal(response.headers["x-prefix"], "1");
    assert.equal(response.headers["x-handler"], "2");
    assert.equal(response.headers["x-postfix"], "3");
  });

  it("keeps the status and body of a returned HTTPResult", async () => {
    const path = `${ROUTE_ROOT}/result`;
    register("handler", path, () => new HTTPResult(201, { created: true }));

    const response = await request(port, path);
    assert.equal(response.status, 201);
    assert.equal(response.body, '{"created":true}');
    assert.equal(response.headers["content-type"], "application/json");
  });

  it("creates the Not Found response only for a route miss", async () => {
    const path = `${ROUTE_ROOT}/missing`;
    let monitorStatus = 0;
    let monitorBody: unknown;
    register("monitor", path, ({ response }) => {
      monitorStatus = response.getStatus();
      monitorBody = response.getBody();
    });

    const response = await request(port, path);
    assert.equal(response.status, 404);
    assert.equal(response.body, "Not Found");
    assert.equal(monitorStatus, 404);
    assert.equal(monitorBody, "Not Found");
  });

  it("isolates monitor response snapshots", async () => {
    const path = `${ROUTE_ROOT}/monitor`;
    let snapshot: HTTPResult | undefined;
    register("handler", path, ({ response }) => {
      response.addHeader("X-Handler", "kept");
      return "body";
    });
    register("monitor", path, ({ response }) => {
      snapshot = response;
      response.setBody("changed");
      response.addHeader("X-Monitor", "isolated");
    });

    const response = await request(port, path);
    assert.equal(response.body, "body");
    assert.equal(response.headers["x-handler"], "kept");
    assert.equal(response.headers["x-monitor"], undefined);
    assert.equal(snapshot?.getBody(), "changed");
  });

  it("preserves headers while converting thrown errors", async () => {
    const path = `${ROUTE_ROOT}/error`;
    register("prefix", path, ({ response }) =>
      response.addHeader("X-Prefix", "kept"),
    );
    register("handler", path, () => {
      throw new Error("failure");
    });

    const response = await request(port, path);
    assert.equal(response.status, 500);
    assert.equal(response.body, "failure");
    assert.equal(response.headers["x-prefix"], "kept");
  });

  it("sends HEAD through HTTPResult without a response body", async () => {
    const path = `${ROUTE_ROOT}/head`;
    register("handler", path, () => "not sent");

    const response = await request(port, path, "HEAD");
    assert.equal(response.status, 200);
    assert.equal(response.body, "");
    assert.equal(response.headers["content-type"], "text/plain");
  });

  it("keeps stream status, headers, and body", async () => {
    const path = `${ROUTE_ROOT}/stream`;
    register("handler", path, ({ response }) => {
      response.addHeader("X-Stream", "kept");
      response.getWriteStream("text/event-stream", 206).end("event");
    });

    const response = await request(port, path);
    assert.equal(response.status, 206);
    assert.equal(response.body, "event");
    assert.equal(response.headers["content-type"], "text/event-stream");
    assert.equal(response.headers["x-stream"], "kept");
  });
});
