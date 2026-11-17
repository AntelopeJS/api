import assert from "node:assert";
import * as http from "node:http";
import * as net from "node:net";
import { WebSocket } from "ws";

import { DEFAULT_SHUTDOWN_GRACE_PERIOD_MS } from "../server-config";
import { stop } from "../index";
import {
  LONG_GRACE_PERIOD_MS,
  LONG_RESPONSE_MS,
  ROUTE_ROOT,
  SLOW_RESPONSE_BODY,
  SLOW_RESPONSE_MS,
  SUCCESS_STATUS,
  TEST_HOST,
  delay,
  handledRequests,
  register,
  registerSlowRoute,
  request,
  restoreServerAfterEach,
  serve,
} from "./connection-fixture";

const STREAM_PORT = 25400;
const IN_FLIGHT_PORT = 25410;
const WEBSOCKET_PORT = 25420;
const LONG_REQUEST_PORT = 25430;
const KEEP_ALIVE_PORT = 25440;
const UNBOUNDED_GRACE_PORT = 25450;
const PIPELINED_PORT = 25460;
const QUEUED_PORT = 25470;
const REUSED_PORT = 25480;
const PIPELINED_REUSE_PORT = 25490;
const STREAMED_PORT = 25500;
const STREAM_PATH = `${ROUTE_ROOT}/stream`;
const SLOW_PATH = `${ROUTE_ROOT}/slow`;
const LONG_PATH = `${ROUTE_ROOT}/long`;
const KEEP_ALIVE_PATH = `${ROUTE_ROOT}/keep-alive`;
const UNBOUNDED_PATH = `${ROUTE_ROOT}/unbounded`;
const PIPELINED_PATH = `${ROUTE_ROOT}/pipelined`;
const QUEUED_SLOW_PATH = `${ROUTE_ROOT}/queued-slow`;
const QUEUED_FAST_PATH = `${ROUTE_ROOT}/queued-fast`;
const FAST_RESPONSE_MS = 0;
const REUSED_PATH = `${ROUTE_ROOT}/reused`;
const STREAMED_PATH = `${ROUTE_ROOT}/streamed`;
const STREAM_CHUNK = "a";
const CHUNKED_BODY_END = "0\r\n\r\n";
const FIRST_OF_PAIR_MS = 50;
const PAIR_FIRST_PATH = `${ROUTE_ROOT}/pair-first`;
const PAIR_LAST_PATH = `${ROUTE_ROOT}/pair-last`;
const FAST_RESPONSE_SETTLE_MS = 50;
const OK_STATUS_LINE = /HTTP\/1\.1 200 OK/g;
const SOCKET_PATH = `${ROUTE_ROOT}/socket`;
const STREAM_EVENT = "data: ready\n\n";
const STOP_MARGIN_MS = 1000;
const STOP_DEADLINE_MS = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS + STOP_MARGIN_MS;

async function measureStop(): Promise<number> {
  const startedAt = Date.now();
  await stop();
  return Date.now() - startedAt;
}

function openStream(port: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    http
      .get(
        { host: TEST_HOST, port, path: STREAM_PATH, agent: false },
        (res) => {
          res.once("data", () => resolve(res));
        },
      )
      .once("error", reject);
  });
}

function waitForClose(
  emitter: http.IncomingMessage | WebSocket,
): Promise<void> {
  return new Promise((resolve) => emitter.once("close", () => resolve()));
}

function pipelineRequests(port: number, paths: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const requests = paths
      .map((path) => `GET ${path} HTTP/1.1\r\nHost: ${TEST_HOST}\r\n\r\n`)
      .join("");
    const socket = net.connect(port, TEST_HOST, () => socket.write(requests));
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("close", () => resolve(Buffer.concat(chunks).toString()));
    socket.once("error", reject);
  });
}

/**
 * Pipelines `paths` on one connection, then sends one more request on it
 * as soon as every response has arrived and the last ends with
 * `responseEnd`, as a keep-alive client reusing the connection would.
 * Resolves with the number of responses the client read.
 */
function reuseConnection(
  port: number,
  paths: string[],
  responseEnd: string,
): Promise<number> {
  return new Promise((resolve) => {
    const toRequest = (path: string) =>
      `GET ${path} HTTP/1.1\r\nHost: ${TEST_HOST}\r\n\r\n`;
    const socket = net.connect(port, TEST_HOST, () =>
      socket.write(paths.map(toRequest).join("")),
    );
    const countResponses = () => received.match(OK_STATUS_LINE)?.length ?? 0;
    let received = "";
    let reused = false;
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString();
      if (
        !reused &&
        countResponses() === paths.length &&
        received.endsWith(responseEnd)
      ) {
        reused = true;
        socket.write(toRequest(paths[0]), () => undefined);
      }
    });
    socket.on("error", () => undefined);
    socket.once("close", () => resolve(countResponses()));
  });
}

function openWebSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${TEST_HOST}:${port}${SOCKET_PATH}`);
    socket.once("message", () => resolve(socket));
    socket.once("error", reject);
  });
}

/**
 * Registers a route that sends its headers and a first chunk at once, then
 * ends after `durationMs`; the promise resolves once a request is handled.
 */
function registerStreamingRoute(path: string, durationMs: number) {
  let markReceived: () => void = () => undefined;
  const received = new Promise<void>((resolve) => {
    markReceived = resolve;
  });
  register("handler", path, ({ response }) => {
    handledRequests.count += 1;
    const stream = response.getWriteStream("text/plain");
    stream.write(STREAM_CHUNK);
    setTimeout(() => stream.end(), durationMs);
    markReceived();
  });
  return received;
}

describe("Stopping with open connections", () => {
  restoreServerAfterEach();

  it("ends an open event stream within the grace period", async () => {
    register("handler", STREAM_PATH, ({ response }) => {
      response.getWriteStream("text/event-stream").write(STREAM_EVENT);
    });
    await serve(STREAM_PORT);
    const stream = await openStream(STREAM_PORT);
    stream.on("error", () => undefined);
    const streamClosed = waitForClose(stream);

    const stopDuration = await measureStop();

    assert.ok(
      stopDuration < STOP_DEADLINE_MS,
      `Stop took ${stopDuration} ms with an open event stream`,
    );
    await streamClosed;
  });

  it("lets an in-flight request complete", async () => {
    const received = registerSlowRoute(SLOW_PATH, SLOW_RESPONSE_MS);
    await serve(IN_FLIGHT_PORT);
    const response = request(IN_FLIGHT_PORT, SLOW_PATH);
    await received;

    const stopping = stop();

    assert.deepEqual(await response, {
      status: SUCCESS_STATUS,
      body: SLOW_RESPONSE_BODY,
    });
    await stopping;
  });

  it("ends an open websocket within the grace period", async () => {
    register("websocket", SOCKET_PATH, (context) => {
      assert.ok(context.connection);
      context.connection.send("connected");
    });
    await serve(WEBSOCKET_PORT);
    const socket = await openWebSocket(WEBSOCKET_PORT);
    const socketClosed = waitForClose(socket);

    const stopDuration = await measureStop();

    assert.ok(
      stopDuration < STOP_DEADLINE_MS,
      `Stop took ${stopDuration} ms with an open websocket`,
    );
    await socketClosed;
  });
});

describe("Stopping under a configured grace period", () => {
  restoreServerAfterEach();

  it("answers every request it handles on a connection reused during stop", async () => {
    const received = registerSlowRoute(REUSED_PATH, SLOW_RESPONSE_MS);
    await serve(REUSED_PORT, LONG_GRACE_PERIOD_MS);
    const responses = reuseConnection(
      REUSED_PORT,
      [REUSED_PATH],
      SLOW_RESPONSE_BODY,
    );
    await received;

    await stop();

    assert.equal(await responses, handledRequests.count);
  });

  it("answers every request it handles on a pipelined connection reused during stop", async () => {
    const firstReceived = registerSlowRoute(PAIR_FIRST_PATH, FIRST_OF_PAIR_MS);
    const lastReceived = registerSlowRoute(PAIR_LAST_PATH, SLOW_RESPONSE_MS);
    await serve(PIPELINED_REUSE_PORT, LONG_GRACE_PERIOD_MS);
    const responses = reuseConnection(
      PIPELINED_REUSE_PORT,
      [PAIR_FIRST_PATH, PAIR_LAST_PATH],
      SLOW_RESPONSE_BODY,
    );
    await Promise.all([firstReceived, lastReceived]);

    await stop();

    assert.equal(await responses, handledRequests.count);
  });

  it("answers every request it handles on a reused connection that streamed before stop", async () => {
    const received = registerStreamingRoute(STREAMED_PATH, SLOW_RESPONSE_MS);
    await serve(STREAMED_PORT, LONG_GRACE_PERIOD_MS);
    const responses = reuseConnection(
      STREAMED_PORT,
      [STREAMED_PATH],
      CHUNKED_BODY_END,
    );
    await received;
    await delay(FAST_RESPONSE_SETTLE_MS);

    await stop();

    assert.equal(await responses, handledRequests.count);
  });

  it("lets a request outlive the default grace period under a longer configured one", async () => {
    const received = registerSlowRoute(LONG_PATH, LONG_RESPONSE_MS);
    await serve(LONG_REQUEST_PORT, LONG_GRACE_PERIOD_MS);
    const response = request(LONG_REQUEST_PORT, LONG_PATH);
    await received;

    const stopping = stop();

    assert.deepEqual(await response, {
      status: SUCCESS_STATUS,
      body: SLOW_RESPONSE_BODY,
    });
    await stopping;
  });

  it("ends a keep-alive connection with its last in-flight request", async () => {
    const received = registerSlowRoute(KEEP_ALIVE_PATH, SLOW_RESPONSE_MS);
    await serve(KEEP_ALIVE_PORT, LONG_GRACE_PERIOD_MS);
    const agent = new http.Agent({ keepAlive: true });
    const response = request(KEEP_ALIVE_PORT, KEEP_ALIVE_PATH, agent);
    await received;

    const stopDuration = await measureStop();

    assert.deepEqual(await response, {
      status: SUCCESS_STATUS,
      body: SLOW_RESPONSE_BODY,
    });
    agent.destroy();
    assert.ok(
      stopDuration < LONG_GRACE_PERIOD_MS,
      `Stop took ${stopDuration} ms after the last request on a keep-alive connection`,
    );
  });

  it("lets an in-flight request complete under an unbounded grace period", async () => {
    const received = registerSlowRoute(UNBOUNDED_PATH, SLOW_RESPONSE_MS);
    await serve(UNBOUNDED_GRACE_PORT, Infinity);
    const response = request(UNBOUNDED_GRACE_PORT, UNBOUNDED_PATH);
    await received;

    const stopping = stop();

    assert.deepEqual(await response, {
      status: SUCCESS_STATUS,
      body: SLOW_RESPONSE_BODY,
    });
    await stopping;
  });

  it("answers every pipelined request in flight when stop begins", async () => {
    const bothReceived = registerSlowRoute(PIPELINED_PATH, SLOW_RESPONSE_MS, 2);
    await serve(PIPELINED_PORT, LONG_GRACE_PERIOD_MS);
    const raw = pipelineRequests(PIPELINED_PORT, [
      PIPELINED_PATH,
      PIPELINED_PATH,
    ]);
    await bothReceived;

    const stopDuration = await measureStop();

    assert.equal((await raw).match(OK_STATUS_LINE)?.length, 2);
    assert.ok(
      stopDuration < LONG_GRACE_PERIOD_MS,
      `Stop took ${stopDuration} ms after the last pipelined request`,
    );
  });

  it("ends a connection once a pipelined response queued behind a slow one is sent", async () => {
    const slowReceived = registerSlowRoute(QUEUED_SLOW_PATH, SLOW_RESPONSE_MS);
    const fastReceived = registerSlowRoute(QUEUED_FAST_PATH, FAST_RESPONSE_MS);
    await serve(QUEUED_PORT, LONG_GRACE_PERIOD_MS);
    const raw = pipelineRequests(QUEUED_PORT, [
      QUEUED_SLOW_PATH,
      QUEUED_FAST_PATH,
    ]);
    await Promise.all([slowReceived, fastReceived]);
    await delay(FAST_RESPONSE_SETTLE_MS);

    const stopDuration = await measureStop();

    assert.equal((await raw).match(OK_STATUS_LINE)?.length, 2);
    assert.ok(
      stopDuration < LONG_GRACE_PERIOD_MS,
      `Stop took ${stopDuration} ms after a queued pipelined response`,
    );
  });
});
