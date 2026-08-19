import assert from "node:assert";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import WebSocket from "ws";
import {
  registerHandler,
  requestListener,
  unregisterHandler,
  upgradeListener,
} from "../server";

const handlerIds: string[] = [];
let server: Server;
let port: number;

function register(
  id: string,
  mode: "handler" | "monitor" | "websocket",
  location: string,
  handler: Parameters<typeof registerHandler>[4],
): void {
  handlerIds.push(id);
  registerHandler(id, mode, "get", location, handler);
}

function sendRawRequest(target: string, host?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const hostHeader = host === undefined ? "" : `Host: ${host}\r\n`;
      socket.end(`GET ${target} HTTP/1.0\r\n${hostHeader}\r\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("end", () => resolve(response.split("\r\n\r\n")[1] ?? ""));
    socket.on("error", reject);
  });
}

describe("Request context URL", () => {
  before(async () => {
    server = createServer((req, res) => requestListener(req, res, "http"));
    server.on("upgrade", (req, socket, head) =>
      upgradeListener(req, socket, head, "ws"),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    handlerIds.forEach(unregisterHandler);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("keeps url enumerable without reading it", async () => {
    register(
      "lazy-url-descriptor",
      "handler",
      "/lazy/descriptor",
      (context) => {
        const descriptor = Object.getOwnPropertyDescriptor(context, "url");
        return {
          enumerable: descriptor?.enumerable,
          hasGetter: typeof descriptor?.get === "function",
          keys: Object.keys(context),
        };
      },
    );

    const body = await sendRawRequest("/lazy/descriptor", "example.test");
    const result = JSON.parse(body);
    assert.equal(result.enumerable, true);
    assert.equal(result.hasGetter, true);
    assert.ok(result.keys.includes("url"));
  });

  it("preserves encoded paths, query decoding, host and protocol", async () => {
    register(
      "lazy-url-encoded",
      "handler",
      "/lazy/encoded/:value",
      (context) => ({
        host: context.url.host,
        protocol: context.url.protocol,
        query: context.url.searchParams.getAll("x"),
        pathname: context.url.pathname,
        value: context.routeParameters.value,
      }),
    );

    const body = await sendRawRequest(
      "/lazy/encoded/caf%C3%A9?x=a%2Bb&x=%2F",
      "example.test:8080",
    );
    assert.deepEqual(JSON.parse(body), {
      host: "example.test:8080",
      protocol: "http:",
      query: ["a+b", "/"],
      pathname: "/lazy/encoded/caf%C3%A9",
      value: "caf%C3%A9",
    });
  });

  it("uses WHATWG normalization for dot segments", async () => {
    register(
      "lazy-url-dot",
      "handler",
      "/lazy/dot",
      (context) => context.url.pathname,
    );

    const body = await sendRawRequest("/lazy/skipped/../dot", "example.test");
    assert.equal(body, "/lazy/dot");
  });

  it("supports absolute request targets", async () => {
    register(
      "lazy-url-absolute",
      "handler",
      "/lazy/absolute",
      (context) => context.url.href,
    );

    const body = await sendRawRequest(
      "http://absolute.example/lazy/absolute?q=one%20two",
      "ignored.example",
    );
    assert.equal(body, "http://absolute.example/lazy/absolute?q=one%20two");
  });

  it("supports protocol-relative request targets", async () => {
    register(
      "lazy-url-protocol-relative",
      "handler",
      "/lazy/protocol-relative",
      (context) => context.url.origin,
    );

    const body = await sendRawRequest(
      "//relative.example/lazy/protocol-relative",
      "ignored.example",
    );
    assert.equal(body, "http://relative.example");
  });

  it("falls back to localhost when Host is absent", async () => {
    register(
      "lazy-url-hostless",
      "handler",
      "/lazy/hostless",
      (context) => context.url.origin,
    );

    const body = await sendRawRequest("/lazy/hostless");
    assert.equal(body, "http://localhost");
  });

  it("keeps url assignable", async () => {
    register(
      "lazy-url-assignable",
      "handler",
      "/lazy/assignable",
      (context) => {
        context.url = new URL("https://replacement.example/assigned");
        return context.url.href;
      },
    );

    const body = await sendRawRequest("/lazy/assignable", "original.example");
    assert.equal(body, "https://replacement.example/assigned");
  });

  it("snapshots the request target and host before lazy access", async () => {
    register("lazy-url-snapshot", "handler", "/lazy/snapshot", (context) => {
      context.rawRequest.url = "/mutated";
      context.rawRequest.headers.host = "mutated.example";
      return context.url.href;
    });

    const body = await sendRawRequest(
      "/lazy/snapshot?original=true",
      "original.example",
    );
    assert.equal(body, "http://original.example/lazy/snapshot?original=true");
  });

  it("preserves encoded URL semantics for WebSocket upgrades", async () => {
    register(
      "lazy-url-websocket",
      "websocket",
      "/lazy/socket/:value",
      (context) => {
        const connection = context.connection as WebSocket;
        connection.send(
          JSON.stringify({
            pathname: context.url.pathname,
            protocol: context.url.protocol,
            value: context.routeParameters.value,
          }),
        );
      },
    );

    const result = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/lazy/socket/caf%C3%A9?value=a%2Fb`,
      );
      socket.once("message", (message) => {
        resolve(message.toString());
        socket.close();
      });
      socket.once("error", reject);
    });
    assert.deepEqual(JSON.parse(result), {
      pathname: "/lazy/socket/caf%C3%A9",
      protocol: "ws:",
      value: "caf%C3%A9",
    });
  });

  it("preserves url through the monitor context spread", async () => {
    let monitorResult: Record<string, unknown> | undefined;
    register(
      "lazy-url-monitor-handler",
      "handler",
      "/lazy/monitor",
      () => "ok",
    );
    register("lazy-url-monitor", "monitor", "/lazy/monitor", (context) => {
      const descriptor = Object.getOwnPropertyDescriptor(context, "url");
      monitorResult = {
        enumerable: descriptor?.enumerable,
        isDataProperty: "value" in (descriptor ?? {}),
        isUrl: context.url instanceof URL,
        pathname: context.url.pathname,
      };
    });

    await sendRawRequest("/lazy/monitor?observed=true", "example.test");
    assert.deepEqual(monitorResult, {
      enumerable: true,
      isDataProperty: true,
      isUrl: true,
      pathname: "/lazy/monitor",
    });
  });
});
