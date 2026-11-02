import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, header, headerIs, status } from "./client.ts";
import { HANDLERS_SOURCE } from "./sources-handlers.ts";
import { open, type Session } from "./session.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

async function drainLog(session: Session, name: string) {
  const answer = await session.run(name, "return controllers.log.splice(0);");
  session.context.expect(answer.folder, [holds("the scenario ran", answer.ok, JSON.stringify(answer.error))]);
  return answer.value;
}

export const handlerModes: Journey = {
  title: "a prefix that returns a value, a plain string included, supplies the response and skips the main handler, a prefix that throws an HTTPResult answers it, a postfix adjusts the result, and a monitor observes success and failure, a thrown HTTPResult as ctx.error, with its return value ignored",
  entryPoint: "`@Prefix`, `@Get`, `@Postfix` and `@Monitor` on one controller, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: HANDLERS_SOURCE });
    const ok = await session.get("GET /users/u1", "/users/u1");
    context.expect(ok.folder, [status("the main handler answers when the prefix returns nothing", ok, 200), same("main body", ok.json, { id: "u1", name: "Sample User" }), headerIs("the postfix header", ok, "x-accessed-at", "postfix")]);
    context.expect(ok.folder, [same("a monitor observes the finished response", await drainLog(session, "read the monitor log"), ["200:ok:u1"])]);
    const missing = await session.get("GET /users/missing", "/users/missing");
    context.expect(missing.folder, [status("the prefix response", missing, 404), same("the prefix body replaces the main handler's", missing.json, { error: "User not found" })]);
    const afterPrefix = await drainLog(session, "read the monitor log after the prefix response");
    context.expect(missing.folder, [same("a monitor observes a response a prefix supplied", afterPrefix, ["404:ok:missing"])]);
    const failed = await session.get("GET /failing/7", "/failing/7");
    context.expect(failed.folder, [status("a throwing handler", failed, 500)]);
    const afterFailure = await drainLog(session, "read the monitor log after the failure");
    context.expect(failed.folder, [same("a monitor observes the error", afterFailure, ["500:Error: boom 7"])]);
    context.expect(ok.folder, [holds("the monitor's HTTPResult(418) was ignored", ok.status === 200)]);
    const plain = await session.get("GET /pp/plain", "/pp/plain");
    context.expect(plain.folder, [status("a prefix that returns a plain string", plain, 200), bodyIs("its value becomes the response", plain, "from the prefix")]);
    const guarded = await session.get("GET /pp/guarded", "/pp/guarded");
    context.expect(guarded.folder, [status("a prefix that throws an HTTPResult answers its status", guarded, 401), bodyIs("and its body", guarded, "no token")]);
    const teapot = await session.get("GET /pp/teapot", "/pp/teapot");
    context.expect(teapot.folder, [status("a handler that throws an HTTPResult", teapot, 418)]);
    context.expect(teapot.folder, [same("neither main handler ran behind its prefix, and the monitor's ctx.error is the thrown HTTPResult", await drainLog(session, "read the log after the prefixes and the thrown HTTPResult"), ["monitor:418:HTTPResult 418"])]);
    await finish(session);
  },
};

export const handlerPriority: Journey = {
  title: "prefix handlers run from HIGHEST to LOWEST whatever their declaration order, the first one that returns a value ends the chain, and a prefix, postfix or monitor without a priority runs at NORMAL",
  entryPoint: "five `@Prefix(\"get\", \"data\", HandlerPriority.X)` handlers on one route, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: HANDLERS_SOURCE });
    const allowed = await session.get("GET /api/data with credentials", "/api/data", { headers: { "x-token": "t", "x-role": "admin" } });
    context.expect(allowed.folder, [status("every prefix passed", allowed, 200), same("main body", allowed.json, { data: 1 })]);
    context.expect(allowed.folder, [same("execution order", await drainLog(session, "read the order"), ["highest", "high", "normal", "low", "lowest", "main"])]);
    const anonymous = await session.get("GET /api/data without a token", "/api/data");
    context.expect(anonymous.folder, [status("HIGHEST refuses", anonymous, 401), same("its body", anonymous.json, { error: "Unauthorized" })]);
    context.expect(anonymous.folder, [same("nothing after the refusing prefix ran", await drainLog(session, "read the order after 401"), ["highest"])]);
    const guest = await session.get("GET /api/data as guest", "/api/data", { headers: { "x-token": "t", "x-role": "guest" } });
    context.expect(guest.folder, [status("HIGH refuses", guest, 403), same("its body", guest.json, { error: "Forbidden" })]);
    context.expect(guest.folder, [same("only the handlers up to the refusal ran", await drainLog(session, "read the order after 403"), ["highest", "high"])]);
    const order = await session.get("GET /prio/order", "/prio/order");
    context.expect(order.folder, [status("handlers without a priority", order, 200)]);
    await session.run("wait for the monitors", "await waitFor(200); return null;");
    context.expect(order.folder, [same("a handler without a priority runs at NORMAL, between HIGH and LOW, in every mode", await drainLog(session, "read the default-priority order"), ["prefix-high", "prefix-default", "prefix-low", "main", "postfix-high", "postfix-default", "postfix-low", "monitor-high", "monitor-default", "monitor-low"])]);
    await finish(session);
  },
};

export const postfixChain: Journey = {
  title: "postfix handlers all run in priority order unless one returns a value, which skips every later postfix; a throwing monitor changes neither the response nor the other monitors",
  entryPoint: "`@Postfix` and `@Monitor` handlers at three priorities on one route, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: HANDLERS_SOURCE });
    const all = await session.get("GET /chain/all", "/chain/all");
    context.expect(all.folder, [status("main", all, 200), same("body", all.json, { main: "all" }), headerIs("first postfix", all, "x-first", "yes"), headerIs("second postfix", all, "x-second", "yes"), headerIs("third postfix", all, "x-third", "yes")]);
    const stopped = await session.get("GET /chain/stop", "/chain/stop");
    context.expect(stopped.folder, [headerIs("the first postfix ran before the one that returned", stopped, "x-first", "yes"), headerIs("the postfix after a returning one is skipped", stopped, "x-third", undefined), holds("the returning postfix's value is the response", header(stopped, "x-third") === undefined && stopped.status === 202, `status ${String(stopped.status)}`), bodyIs("the returning postfix's body", stopped, '{"replaced":true}')]);
    const monitored = await session.get("GET /chain/monitored", "/chain/monitored");
    context.expect(monitored.folder, [status("a throwing monitor", monitored, 200), same("leaves the body", monitored.json, { ok: true })]);
    await session.run("wait for the monitors", "await waitFor(200); return null;");
    context.expect(monitored.folder, [same("both monitors ran, in priority order", await drainLog(session, "read the monitor log"), ["monitor-1", "monitor-2"])]);
    await finish(session);
  },
};
