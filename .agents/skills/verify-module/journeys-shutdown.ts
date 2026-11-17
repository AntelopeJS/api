import { setTimeout as sleep } from "node:timers/promises";
import { interrupted, type Journey, type JourneyContext } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { status } from "./client.ts";
import { open, type ModuleConfig } from "./session.ts";

const SLOW_MS = 2500;
const LONG_GRACE_MS = 4000;
const DEFAULT_GRACE_MS = 1000;
const IN_FLIGHT_BEFORE_SIGNAL_MS = 500;

const SHUTDOWN_SOURCE = String.raw`import { Controller, Get } from "@antelopejs/interface-api";

export class SlowController extends Controller("/slow") {
  @Get("")
  async slow() {
    await new Promise((resolve) => setTimeout(resolve, ${String(SLOW_MS)}));
    return { done: true };
  }
}
`;

/** Sends a request to the slow route, interrupts the project while it is in flight and reports how the request ended and how long the stop took. */
async function stopDuringRequest(context: JourneyContext, config: ModuleConfig, label: string) {
  const session = await open(context, { controllers: SHUTDOWN_SOURCE, config });
  const reply = session.get(`GET /slow, ${label}`, "/slow", { timeoutMs: SLOW_MS + LONG_GRACE_MS });
  await sleep(IN_FLIGHT_BEFORE_SIGNAL_MS);
  const signalledAt = Date.now();
  const stopped = await session.stop();
  const stopMs = Date.now() - signalledAt;
  context.expect(stopped.folder, [interrupted(stopped)]);
  return { reply: await reply, stopMs, stopFolder: stopped.folder };
}

export const serverShutdown: Journey = {
  title: "Ctrl+C lets a request in flight finish within shutdownGracePeriodMs and exits once it is answered, while the default grace of 1 s cuts the same request",
  entryPoint: "`shutdownGracePeriodMs` in the module's config, and Ctrl+C on `ajs project dev` while a request is in flight",
  async run(context) {
    const long = await stopDuringRequest(context, { shutdownGracePeriodMs: LONG_GRACE_MS }, `under a ${String(LONG_GRACE_MS)} ms grace`);
    context.expect(long.reply.folder, [status("the request in flight is answered", long.reply, 200), same("its body", long.reply.json, { done: true })]);
    context.expect(long.stopFolder, [holds("the project exits once the request is answered, not at the end of the grace", long.stopMs < LONG_GRACE_MS, `stopped after ${String(long.stopMs)} ms`)]);
    const short = await stopDuringRequest(context, {}, "under the default grace");
    context.expect(short.reply.folder, [holds("the default grace cuts a request longer than it", short.reply.status !== 200, `status ${String(short.reply.status)}`)]);
    context.expect(short.stopFolder, [holds("the project exits at the end of the default grace", short.stopMs < SLOW_MS - IN_FLIGHT_BEFORE_SIGNAL_MS, `stopped after ${String(short.stopMs)} ms, grace ${String(DEFAULT_GRACE_MS)} ms`)]);
  },
};

const DEPENDENT_MS = 1500;

const DEPENDENT_SOURCE = String.raw`import { Controller, Get } from "@antelopejs/interface-api";

export class DependentController extends Controller("/dependent") {
  @Get("")
  async dependent() {
    await new Promise((resolve) => setTimeout(resolve, ${String(DEPENDENT_MS)}));
    if ((globalThis as { verifyStoreStopped?: boolean }).verifyStoreStopped) throw new Error("the store stopped under the request");
    return { done: true };
  }
}
`;

const STORE_MODULE = String.raw`"use strict";
exports.construct = function construct() {};
exports.start = function start() {};
exports.stop = function stop() { globalThis.verifyStoreStopped = true; };
exports.destroy = function destroy() {};
`;

export const serverDrain: Journey = {
  title: "Ctrl+C answers a request in flight 200 although a module its handler calls stops at shutdown",
  entryPoint: "Ctrl+C on `ajs project dev` while a request is in flight whose handler needs another module of the project",
  async run(context) {
    const session = await open(context, { controllers: DEPENDENT_SOURCE, extra: STORE_MODULE, config: { shutdownGracePeriodMs: LONG_GRACE_MS } });
    const reply = session.get("GET /dependent, interrupted while in flight", "/dependent", { timeoutMs: DEPENDENT_MS + LONG_GRACE_MS });
    await sleep(IN_FLIGHT_BEFORE_SIGNAL_MS);
    const stopped = await session.stop();
    context.expect(stopped.folder, [interrupted(stopped)]);
    const answered = await reply;
    context.expect(answered.folder, [status("the request in flight is answered before the store stops", answered, 200), same("its body", answered.json, { done: true })]);
  },
};
