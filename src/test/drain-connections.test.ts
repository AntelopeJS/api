import assert from "node:assert";

import { drain, stop } from "../index";
import {
  type CapturedResponse,
  LONG_GRACE_PERIOD_MS,
  LONG_RESPONSE_MS,
  ROUTE_ROOT,
  SLOW_RESPONSE_BODY,
  SLOW_RESPONSE_MS,
  SUCCESS_STATUS,
  delay,
  register,
  registerSlowRoute,
  request,
  restoreServerAfterEach,
  serve,
} from "./connection-fixture";

const DRAIN_PORT = 25520;
const DRAIN_THEN_STOP_PORT = 25530;
const DRAIN_DEFAULT_GRACE_PORT = 25540;
const DRAIN_INVALID_GRACE_PORT = 25550;
const DRAIN_SHORT_GRACE_PORT = 25560;
const DEPENDENT_PATH = `${ROUTE_ROOT}/dependent`;
const DRAIN_THEN_STOP_PATH = `${ROUTE_ROOT}/drain-then-stop`;
const DRAIN_DEFAULT_GRACE_PATH = `${ROUTE_ROOT}/drain-default-grace`;
const DRAIN_INVALID_GRACE_PATH = `${ROUTE_ROOT}/drain-invalid-grace`;
const DRAIN_SHORT_GRACE_PATH = `${ROUTE_ROOT}/drain-short-grace`;
const SHORT_GRACE_PERIOD_MS = 100;
const DRAINED_RESPONSE_MS = 2000;
const DRAINED_TEST_TIMEOUT_MS = 2 * DRAINED_RESPONSE_MS;

/**
 * Registers a route that answers after `durationMs` unless the module it
 * depends on stopped meanwhile, as a handler calling a database module
 * does. `received` resolves once a request is handled.
 */
function registerDependentRoute(path: string, durationMs: number) {
  let dependencyStopped = false;
  let markReceived: () => void = () => undefined;
  const received = new Promise<void>((resolve) => {
    markReceived = resolve;
  });
  register("handler", path, async () => {
    markReceived();
    await delay(durationMs);
    if (dependencyStopped) {
      throw new Error("the dependency stopped under the request");
    }
    return SLOW_RESPONSE_BODY;
  });
  return {
    received,
    stopDependency: () => {
      dependencyStopped = true;
    },
  };
}

/**
 * Serves a route answering after `durationMs`, sends it a request and
 * drains once the request is handled. Resolves, after the drain, with the
 * pending response.
 */
async function drainDuringRequest(
  port: number,
  path: string,
  durationMs: number,
  shutdownGracePeriodMs?: number,
): Promise<{ response: Promise<CapturedResponse> }> {
  const received = registerSlowRoute(path, durationMs);
  await serve(port, shutdownGracePeriodMs);
  const response = request(port, path);
  response.catch(() => undefined);
  await received;

  await drain();

  return { response };
}

describe("Draining at shutdown", () => {
  restoreServerAfterEach();

  it("answers a request in flight before a module it depends on stops after the drain", async () => {
    const route = registerDependentRoute(DEPENDENT_PATH, SLOW_RESPONSE_MS);
    await serve(DRAIN_PORT);
    const response = request(DRAIN_PORT, DEPENDENT_PATH);
    await route.received;

    await drain();
    route.stopDependency();

    assert.deepEqual(await response, {
      status: SUCCESS_STATUS,
      body: SLOW_RESPONSE_BODY,
    });
  });

  it("makes a stop that arrives during the drain wait for the request in flight", async () => {
    const route = registerDependentRoute(
      DRAIN_THEN_STOP_PATH,
      LONG_RESPONSE_MS,
    );
    await serve(DRAIN_THEN_STOP_PORT, LONG_GRACE_PERIOD_MS);
    const response = request(DRAIN_THEN_STOP_PORT, DRAIN_THEN_STOP_PATH);
    await route.received;

    const draining = drain();
    await stop();
    route.stopDependency();

    assert.equal((await response).status, SUCCESS_STATUS);
    await draining;
  });

  it("answers a 2 s request in flight without shutdownGracePeriodMs", async function () {
    this.timeout(DRAINED_TEST_TIMEOUT_MS);
    const { response } = await drainDuringRequest(
      DRAIN_DEFAULT_GRACE_PORT,
      DRAIN_DEFAULT_GRACE_PATH,
      DRAINED_RESPONSE_MS,
    );

    assert.deepEqual(await response, {
      status: SUCCESS_STATUS,
      body: SLOW_RESPONSE_BODY,
    });
  });

  it("answers a 2 s request in flight when shutdownGracePeriodMs is not a number", async function () {
    this.timeout(DRAINED_TEST_TIMEOUT_MS);
    const { response } = await drainDuringRequest(
      DRAIN_INVALID_GRACE_PORT,
      DRAIN_INVALID_GRACE_PATH,
      DRAINED_RESPONSE_MS,
      Number.NaN,
    );

    assert.equal((await response).status, SUCCESS_STATUS);
  });

  it("cuts a request longer than a configured shutdownGracePeriodMs", async () => {
    const { response } = await drainDuringRequest(
      DRAIN_SHORT_GRACE_PORT,
      DRAIN_SHORT_GRACE_PATH,
      LONG_RESPONSE_MS,
      SHORT_GRACE_PERIOD_MS,
    );

    await assert.rejects(response);
  });
});
