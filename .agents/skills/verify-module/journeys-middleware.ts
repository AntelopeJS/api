import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, headerIs, status } from "./client.ts";
import { open, type Session } from "./session.ts";
import { SCOPING_SOURCE } from "./sources-handlers.ts";
import { ASYNC_SOURCE, MATRIX_SOURCE, MODES_SOURCE, STAR_SOURCE } from "./sources-middleware.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

async function drainLog(session: Session, name: string) {
  const answer = await session.run(name, "return controllers.log.splice(0);");
  session.context.expect(answer.folder, [holds("the scenario ran", answer.ok, JSON.stringify(answer.error))]);
  return answer.value;
}

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

export const starMethod: Journey = {
  title: "a prefix, postfix or monitor declared for the method \"*\" runs for every HTTP method",
  entryPoint: "`@Prefix(\"*\")` beside a `@Get` and a `@Post`, and `@Postfix(\"*\")` and `@Monitor(\"*\")` beside a `@Delete`, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: STAR_SOURCE });
    const get = await session.get("GET /star/refused", "/star/refused");
    context.expect(get.folder, [status("the * prefix refuses a GET", get, 418), bodyIs("with its body", get, "any method")]);
    const post = await session.get("POST /star/refused", "/star/refused", { method: "POST", body: "{}" });
    context.expect(post.folder, [status("the * prefix refuses a POST", post, 418), bodyIs("with its body", post, "any method")]);
    context.expect(post.folder, [same("no main handler ran", await drainLog(session, "read the log after the prefix"), [])]);
    const removed = await session.get("DELETE /star/after", "/star/after", { method: "DELETE" });
    context.expect(removed.folder, [status("the main handler answers", removed, 200), headerIs("the * postfix adjusts a DELETE result", removed, "x-star", "postfix")]);
    await session.run("wait for the monitor", "await waitFor(300); return null;");
    context.expect(removed.folder, [same("the * monitor observes the DELETE", await drainLog(session, "read the monitor log"), ["monitor"])]);
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

export const asyncHandlers: Journey = {
  title: "asynchronous prefixes, postfixes, main handlers and monitors behave like synchronous ones: a resolved or thrown HTTPResult answers, a returning postfix skips the later ones, a rejecting monitor stops no other monitor, and a monitor sees the error of a rejecting handler",
  entryPoint: "`async` `@Prefix`, `@Postfix`, `@Get` and `@Monitor` handlers on one controller, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: ASYNC_SOURCE });
    const refused = await session.get("GET /a/refuse", "/a/refuse");
    context.expect(refused.folder, [status("an async prefix resolving an HTTPResult answers it", refused, 403), bodyIs("with its body", refused, "async refused")]);
    const thrown = await session.get("GET /a/throw", "/a/throw");
    context.expect(thrown.folder, [status("an async prefix rejecting with an HTTPResult answers it", thrown, 401), bodyIs("with its body", thrown, "async thrown")]);
    const passed = await session.get("GET /a/pass", "/a/pass");
    context.expect(passed.folder, [status("async prefixes returning nothing continue", passed, 200), same("to the main handler", passed.json, { main: "pass" })]);
    const late = await session.get("GET /a/late", "/a/late");
    context.expect(late.folder, [status("an async main handler", late, 200), same("answers", late.json, { late: true }), headerIs("and the postfix header reaches the client", late, "x-post", "1")]);
    const post = await session.get("GET /a/post", "/a/post");
    context.expect(post.folder, [status("an async postfix resolving an HTTPResult replaces the response", post, 201), bodyIs("with its body", post, "p1"), headerIs("and the later postfix is skipped", post, "x-low", undefined)]);
    const quiet = await session.get("GET /a/quiet", "/a/quiet");
    context.expect(quiet.folder, [headerIs("an async postfix returning nothing keeps the response", quiet, "x-high", "ran"), headerIs("and the next postfix runs", quiet, "x-low", "ran")]);
    const afterPrefixes = await session.run("read the log after the requests", "return controllers.log.splice(0);");
    context.expect(afterPrefixes.folder, [same("refusing prefixes skipped their main handler, passing ones ran in order, the skipped postfix did not run", afterPrefixes.value, ["pass-1", "pass-2", "main-pass"])]);
    const monitored = await session.get("GET /a/mon", "/a/mon");
    context.expect(monitored.folder, [status("a rejecting async monitor", monitored, 200), same("changes nothing", monitored.json, { ok: true })]);
    await session.run("wait for the monitors", "await waitFor(300); return null;");
    context.expect(monitored.folder, [same("every monitor ran, in priority order, after the rejection", await drainLog(session, "read the monitor log"), ["mon-1", "mon-2", "mon-3"])]);
    const failed = await session.get("GET /a/fail", "/a/fail");
    context.expect(failed.folder, [status("an async main handler rejecting", failed, 500), bodyIs("answers the message", failed, "async main failed")]);
    await session.run("wait for the monitor", "await waitFor(300); return null;");
    context.expect(failed.folder, [same("the monitor sees the 500 and the error", await drainLog(session, "read the failure log"), ["fail:500:Error: async main failed"])]);
    await finish(session);
  },
};

const MATRIX_APP = "https://app.example.com";

export const middlewareMatrix: Journey = {
  title: "monitors, prefixes and postfixes interplay: a monitor that returns or resolves a value stops no later monitor, a method-scoped middleware hides no any-method one (CORS headers stay on the route), and an error thrown by a postfix is the response and reaches the monitors",
  entryPoint: "monitors returning values, an any-method monitor, GET-only and OPTIONS prefixes on a route, a refusing prefix and throwing postfixes, with `cors.allowedOrigins` set, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: MATRIX_SOURCE, config: { cors: { allowedOrigins: MATRIX_APP } } });
    const monitored = await session.get("GET /mx/r", "/mx/r");
    context.expect(monitored.folder, [status("a route with monitors that return values", monitored, 200), same("the response is the main handler's", monitored.json, { main: "r" })]);
    await session.run("wait for the monitors", "await waitFor(300); return null;");
    const ran = await session.run("read the monitor log", "return controllers.log.splice(0).sort();");
    context.expect(ran.folder, [same("a monitor that returns, or resolves, a value stops no later monitor, and an any-method monitor runs beside the GET ones", ran.value, ["a", "any", "b", "c"])]);
    const guarded = await session.get("GET /mx/guarded from a listed origin", "/mx/guarded", { headers: { origin: MATRIX_APP } });
    context.expect(guarded.folder, [status("a route with a GET-only prefix", guarded, 200), headerIs("keeps the CORS origin of the any-method prefix", guarded, "access-control-allow-origin", MATRIX_APP), headerIs("and the credentials", guarded, "access-control-allow-credentials", "true")]);
    const preflight = await session.get("OPTIONS /mx/guarded", "/mx/guarded", { method: "OPTIONS", headers: { origin: MATRIX_APP, "access-control-request-method": "GET" } });
    context.expect(preflight.folder, [status("a preflight beside an OPTIONS prefix", preflight, 204), headerIs("carries the CORS origin", preflight, "access-control-allow-origin", MATRIX_APP)]);
    const refused = await session.get("GET /mx/refuse from a listed origin", "/mx/refuse", { headers: { origin: MATRIX_APP } });
    context.expect(refused.folder, [status("a refusing prefix", refused, 401), bodyIs("answers its body", refused, "no token"), headerIs("with the CORS origin", refused, "access-control-allow-origin", MATRIX_APP), headerIs("and the credentials", refused, "access-control-allow-credentials", "true")]);
    const thrown = await session.get("GET /mx/p", "/mx/p");
    context.expect(thrown.folder, [status("a postfix that throws an HTTPResult", thrown, 409), bodyIs("answers it", thrown, "postfix refused")]);
    const rejected = await session.get("GET /mx/pa", "/mx/pa");
    context.expect(rejected.folder, [status("an async postfix that rejects", rejected, 500), bodyIs("answers the message", rejected, "x")]);
    await session.run("wait for the monitors", "await waitFor(300); return null;");
    const seen = await session.run("read the log after the postfixes", "return controllers.log.filter((entry) => entry.startsWith('p')).sort();");
    context.expect(seen.folder, [same("the monitors see the status and the error of a failing postfix", seen.value, ["p:409:true", "pa:500:Error: x"])]);
    await finish(session);
  },
};
