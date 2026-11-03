import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, header, headerIs, status } from "./client.ts";
import { HANDLERS_SOURCE, MODES_SOURCE, SCOPING_SOURCE } from "./sources-handlers.ts";
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
    context.expect(ok.folder, [status("the main handler answers when the prefix returns nothing", ok, 200), same("main body", ok.json, { id: "u1", name: "Sample User" }), headerIs("the postfix header", ok, "x-accessed-at", "postfix"), holds("a monitor observes a snapshot: what it sets on ctx.response never reaches the client", header(ok, "x-monitor") === undefined, String(header(ok, "x-monitor")))]);
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

export const methodScoping: Journey = {
  title: "a prefix, postfix or monitor declared for one HTTP method runs only for that method",
  entryPoint: "`@Prefix`, `@Postfix` and `@Monitor` declared with \"get\" and with \"post\" beside a `@Get` and a `@Post` on the same location, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: SCOPING_SOURCE });
    const getPre = await session.get("GET /m/pre", "/m/pre");
    context.expect(getPre.folder, [status("the GET prefix refuses a GET", getPre, 403), bodyIs("with its body", getPre, "get refused")]);
    const postPre = await session.get("POST /m/pre", "/m/pre", { method: "POST", body: "{}" });
    context.expect(postPre.folder, [status("the POST prefix refuses a POST, not the GET prefix", postPre, 409), bodyIs("with its own body", postPre, "post refused")]);
    const getPost = await session.get("GET /m/post", "/m/post");
    context.expect(getPost.folder, [status("the main handler", getPost, 200), headerIs("the GET postfix ran, the POST one did not", getPost, "x-stamp", "get")]);
    const postPost = await session.get("POST /m/post", "/m/post", { method: "POST", body: "{}" });
    context.expect(postPost.folder, [status("the main handler", postPost, 201), headerIs("the POST postfix ran, the GET one did not", postPost, "x-stamp", "post")]);
    await drainLog(session, "clear the log");
    const getMon = await session.get("GET /m/mon", "/m/mon");
    context.expect(getMon.folder, [status("the main handler", getMon, 200)]);
    const postMon = await session.get("POST /m/mon", "/m/mon", { method: "POST", body: "{}" });
    context.expect(postMon.folder, [status("the main handler", postMon, 201)]);
    await session.run("wait for the monitors", "await waitFor(300); return null;");
    context.expect(postMon.folder, [same("each monitor ran for its own method only", await drainLog(session, "read the monitors"), ["get:200", "post:201"])]);
    const postOnly = await session.get("POST /m/only", "/m/only", { method: "POST", body: "{}" });
    context.expect(postOnly.folder, [status("a POST beside a GET-only prefix is served", postOnly, 201), same("its body", postOnly.json, { main: "only-post" })]);
    context.expect(postOnly.folder, [same("the GET prefix did not run for the POST", await drainLog(session, "read the log after the POST"), [])]);
    const getOnly = await session.get("GET /m/only", "/m/only");
    context.expect(getOnly.folder, [status("the GET", getOnly, 200)]);
    context.expect(getOnly.folder, [same("the GET prefix ran for the GET", await drainLog(session, "read the log after the GET"), ["prefix-get"])]);
    await finish(session);
  },
};

export const falsyReturns: Journey = {
  title: "only a truthy value from a prefix is the response and only a truthy value from a postfix stops the later postfixes",
  entryPoint: "prefixes returning 0, an empty string and false and a postfix returning 0 before another postfix, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: SCOPING_SOURCE });
    for (const kind of ["zero", "empty", "no"]) {
      const answer = await session.get(`GET /falsy/${kind}`, `/falsy/${kind}`);
      context.expect(answer.folder, [status(`a prefix returning ${kind} does not answer`, answer, 200), same("the main handler answers", answer.json, { main: kind })]);
      context.expect(answer.folder, [same("the prefix and then the main handler ran", await drainLog(session, `read the log after ${kind}`), ["prefix", "main"])]);
    }
    const post = await session.get("GET /falsy/post", "/falsy/post");
    context.expect(post.folder, [status("the main handler", post, 200)]);
    context.expect(post.folder, [same("a postfix returning 0 does not stop the next one", await drainLog(session, "read the postfix log"), ["first", "second"])]);
    await finish(session);
  },
};

export const routeModes: Journey = {
  title: "the mode argument of @Get, @Post, @Put and @Delete decides when the method runs: a prefix mode answers before the main handler, a postfix mode adjusts the result, a monitor mode observes",
  entryPoint: "`@Get(location, \"prefix\")`, `@Post`, `@Put` and `@Delete` with a mode beside the same location's main handler, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: MODES_SOURCE });
    const cases = [["GET", 403, "get refused"], ["POST", 409, "post refused"], ["PUT", 422, "put refused"], ["DELETE", 410, "delete refused"]] as const;
    for (const [method, code, text] of cases) {
      const answer = await session.get(`${method} /modes/data`, "/modes/data", { method, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
      context.expect(answer.folder, [status(`a ${method} prefix-mode method answers before the main handler`, answer, code), bodyIs("with its body", answer, text)]);
    }
    const afterPrefixes = await session.run("read the log after the prefixes", "return controllers.log;");
    context.expect(afterPrefixes.folder, [same("no main handler ran", afterPrefixes.value, [])]);
    for (const [method, code, name] of [["POST", 201, "post"], ["PUT", 200, "put"], ["DELETE", 200, "delete"]] as const) {
      const ordered = await session.get(`${method} /modes/order`, "/modes/order", { method, body: method === "DELETE" ? undefined : "{}" });
      context.expect(ordered.folder, [status(`the ${method} main handler answers`, ordered, code), same("with its own body", ordered.json, { main: name })]);
      context.expect(ordered.folder, [same(`the ${method} prefix-mode method ran first, then the main handler`, await drainLog(session, `read the ${method} order`), [`${name}-prefix`, `${name}-main`])]);
    }
    const stamped = await session.get("GET /modes/stamped", "/modes/stamped");
    context.expect(stamped.folder, [status("the main handler answers", stamped, 200), headerIs("a postfix-mode method adjusts the result", stamped, "x-mode", "postfix")]);
    const watched = await session.get("GET /modes/watched", "/modes/watched");
    context.expect(watched.folder, [status("the main handler answers", watched, 200)]);
    await session.run("wait for the monitor", "await waitFor(300); return null;");
    context.expect(watched.folder, [same("a monitor-mode method observes the request", await drainLog(session, "read the monitor log"), ["monitor"])]);
    await finish(session);
  },
};
