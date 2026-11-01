import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, matches, same } from "./checks.ts";
import { bodyIs, header, headerIs, status, type Reply } from "./client.ts";
import { attempt, open, type Session } from "./session.ts";
import { MISPLACED_RATE_LIMIT_SOURCE, UTIL_SOURCE } from "./sources-util.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

export const assertGuards: Journey = {
  title: "assert throws the status and message of a falsy condition and passes every truthy one, including \"0\", an empty list and an empty object",
  entryPoint: "`assert(condition, code, message)` in handlers, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: UTIL_SOURCE });
    const greeted = await session.get("GET /greet?name=Ada", "/greet?name=Ada");
    context.expect(greeted.folder, [status("a non-empty name", greeted, 200), same("greeting", greeted.json, { message: "Hello, Ada!" })]);
    for (const route of ["/greet", "/greet?name=", "/greet?name=%20%20", "/greet?name"]) {
      const refused = await session.get(`GET ${route}`, route);
      context.expect(refused.folder, [status(`${route} is refused`, refused, 400), bodyIs(`${route} message`, refused, "Name is required")]);
    }
    for (const falsy of ["zero", "empty", "nil", "none", "nan", "no"]) {
      const reply = await session.get(`GET /greet/truthy/${falsy}`, `/greet/truthy/${falsy}`);
      context.expect(reply.folder, [status(`${falsy} is falsy`, reply, 418), bodyIs(`${falsy} message`, reply, `falsy ${falsy}`)]);
    }
    for (const truthy of ["text0", "list", "object", "one"]) {
      const reply = await session.get(`GET /greet/truthy/${truthy}`, `/greet/truthy/${truthy}`);
      context.expect(reply.folder, [status(`${truthy} is truthy`, reply, 200), same(`${truthy} passes`, reply.json, { passed: truthy })]);
    }
    const missing = await session.get("DELETE /posts/p2", "/posts/p2", { method: "DELETE", headers: { "x-user": "u1" } });
    context.expect(missing.folder, [status("a resource that does not exist", missing, 404), bodyIs("message", missing, "Post not found")]);
    const forbidden = await session.get("DELETE /posts/p1 as another user", "/posts/p1", { method: "DELETE", headers: { "x-user": "u2" } });
    context.expect(forbidden.folder, [status("a permission that is missing", forbidden, 403), bodyIs("message", forbidden, "Not authorized to delete this post")]);
    const deleted = await session.get("DELETE /posts/p1 as its author", "/posts/p1", { method: "DELETE", headers: { "x-user": "u1" } });
    context.expect(deleted.folder, [status("the author", deleted, 200), same("deleted", deleted.json, { deleted: true })]);
    await finish(session);
  },
};

export const assertValidations: Journey = {
  title: "assertValidation returns the validated value, answers 400 with the stringified error by default, takes the status and body from its code and errorFunc (an errorFunc returning undefined answers no body), and does not convert an asynchronous rejection",
  entryPoint: "`assertValidation(body, validator, errorFunc?, code?)` in POST handlers, called over HTTP; the controllers are declared with relative locations (`\"import\"`, `\"auth\"`)",
  async run(context) {
    const session = await open(context, { controllers: UTIL_SOURCE });
    const ok = await session.get("POST /import with an object", "/import", { method: "POST", body: '{"name":"Ada","n":3,"flag":true}' });
    context.expect(ok.folder, [status("a valid body", ok, 200), same("the validator's result", ok.json, { name: "Ada", n: "3", flag: "true" })]);
    const empty = await session.get("POST /import with {}", "/import", { method: "POST", body: "{}" });
    context.expect(empty.folder, [status("an empty object is valid", empty, 200), same("is returned", empty.json, {})]);
    const notObject = await session.get("POST /import with a number", "/import", { method: "POST", body: "42" });
    context.expect(notObject.folder, [status("a rejected value", notObject, 400), bodyIs("the stringified error", notObject, "Error: Expected a JSON object")]);
    const nullBody = await session.get("POST /import with null", "/import", { method: "POST", body: "null" });
    context.expect(nullBody.folder, [status("a null body", nullBody, 400), bodyIs("the stringified error", nullBody, "Error: Expected a JSON object")]);
    const syntax = await session.get("POST /import with broken JSON", "/import", { method: "POST", body: "{broken" });
    context.expect(syntax.folder, [status("the validator's own error", syntax, 400), matches("the stringified error names the syntax error", syntax.text, /^SyntaxError: /)]);
    const coded = await session.get("POST /import/coded with a number", "/import/coded", { method: "POST", body: "7" });
    context.expect(coded.folder, [status("a given status", coded, 409), bodyIs("the stringified error", coded, "Error: Expected a JSON object")]);
    const custom = await session.get("POST /import/custom with an adult", "/import/custom", { method: "POST", body: '{"age":30}' });
    context.expect(custom.folder, [status("a valid body", custom, 200), same("validated", custom.json, { age: 30 })]);
    const underage = await session.get("POST /import/custom with a minor", "/import/custom", { method: "POST", body: '{"age":12}' });
    context.expect(underage.folder, [status("a given status and errorFunc", underage, 422), same("the errorFunc body", underage.json, { errors: ["age must be at least 18"] })]);
    const silent = await session.get("POST /import/silent with a number", "/import/silent", { method: "POST", body: "7" });
    context.expect(silent.folder, [status("an errorFunc that returns undefined still rejects with the default status", silent, 400), bodyIs("undefined is no body, not the stringified error", silent, "")]);
    const late = await session.get("POST /import/late", "/import/late", { method: "POST", body: "{}" });
    context.expect(late.folder, [holds("an asynchronous rejection is not converted to 400", late.status === 500, `status ${String(late.status)}, body ${late.text}`)]);
    await finish(session);
  },
};

export const rateLimiting: Journey = {
  title: "RateLimit allows the limit within a window and then answers 429 with Retry-After before the handler runs, counts each handler and key separately, keys on the socket IP rather than X-Forwarded-For, and starts a new window after windowMs",
  entryPoint: "`@RateLimit(limit, windowMs, options)` under `@Get` and `@Post`, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: UTIL_SOURCE });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const firstWindow: Reply[] = [];
    for (const remaining of ["2", "1", "0"]) {
      const reply = await session.get(`GET /limited, remaining ${remaining}`, "/limited");
      firstWindow.push(reply);
      context.expect(reply.folder, [status("within the limit", reply, 200), same("body", reply.json, { users: [] }), headerIs("limit", reply, "x-ratelimit-limit", "3"), headerIs("remaining", reply, "x-ratelimit-remaining", remaining)]);
    }
    const reset = Number(header(firstWindow[0], "x-ratelimit-reset"));
    context.expect(firstWindow[0].folder, [holds("Reset is a UNIX timestamp in seconds, at most the window away", reset >= nowSeconds && reset <= nowSeconds + 4, `reset ${String(reset)}, now ${String(nowSeconds)}`)]);
    const rejected = await session.get("GET /limited over the limit", "/limited");
    context.expect(rejected.folder, [status("over the limit", rejected, 429), bodyIs("the default message", rejected, "Too many requests"), holds("Retry-After is a delay in seconds", /^[12]$/.test(header(rejected, "retry-after") ?? ""), String(header(rejected, "retry-after"))), headerIs("limit on a rejection", rejected, "x-ratelimit-limit", "3"), headerIs("remaining on a rejection", rejected, "x-ratelimit-remaining", "0"), holds("reset on a rejection", Number(header(rejected, "x-ratelimit-reset")) >= nowSeconds, String(header(rejected, "x-ratelimit-reset")))]);
    const spoofed = await session.get("GET /limited over the limit with a forged X-Forwarded-For", "/limited", { headers: { "x-forwarded-for": "203.0.113.9" } });
    context.expect(spoofed.folder, [status("the default key is the socket IP, not a client-supplied X-Forwarded-For", spoofed, 429)]);
    const runs = await session.run("count the handler runs", "return controllers.limitedRuns.length;");
    context.expect(runs.folder, [same("a rejected request never reaches the handler", runs.value, 3)]);
    const other = await session.get("GET /limited/other, another decorated handler", "/limited/other");
    context.expect(other.folder, [status("a separate counter", other, 200), headerIs("remaining", other, "x-ratelimit-remaining", "4"), headerIs("limit", other, "x-ratelimit-limit", "5")]);
    for (let call = 1; call <= 3; call += 1) {
      const login = await session.get(`POST /auth/acme/login #${String(call)}`, "/auth/acme/login", { method: "POST" });
      const expected = call <= 2 ? 200 : 429;
      context.expect(login.folder, [status(`tenant acme call ${String(call)}`, login, expected), ...(call <= 2 ? [same("body", login.json, { ok: true }), headerIs("headers survive a replaced response", login, "x-ratelimit-remaining", String(2 - call))] : [bodyIs("the custom message", login, "Too many login attempts, slow down")])]);
    }
    const otherTenant = await session.get("POST /auth/globex/login", "/auth/globex/login", { method: "POST" });
    context.expect(otherTenant.folder, [status("another key has its own counter", otherTenant, 200), headerIs("remaining", otherTenant, "x-ratelimit-remaining", "1")]);
    const keyed: [string, string, number][] = [["a", "first", 200], ["a", "second", 200], ["a", "third", 429], ["b", "first", 200], ["", "first without a key", 200], ["", "second without a key", 200], ["", "third without a key", 429]];
    for (const [who, label, expected] of keyed) {
      const reply = await session.get(`GET /limited/keyed ${who || "without a key"}, ${label}`, who === "" ? "/limited/keyed" : `/limited/keyed?who=${who}`);
      context.expect(reply.folder, [status(`key ${who || "missing (falls back to the client IP)"}, ${label}`, reply, expected), ...(expected === 429 ? [bodyIs("the custom message", reply, "Too many from you")] : [])]);
    }
    await session.run("wait out the window", "await waitFor(1700); return null;");
    const again = await session.get("GET /limited after the window", "/limited");
    context.expect(again.folder, [status("a new window", again, 200), headerIs("the count starts again", again, "x-ratelimit-remaining", "2")]);
    await finish(session);
  },
};

export const rateLimitOrdering: Journey = {
  title: "RateLimit placed above its route decorator makes the module fail to start with an explanation, instead of leaving the route unprotected",
  entryPoint: "`@RateLimit` above `@Get` on a controller loaded by `ajs project dev`",
  async run(context) {
    const started = await attempt(context, "dev", { controllers: MISPLACED_RATE_LIMIT_SOURCE });
    context.expect(started.folder, [
      holds("the project ended by itself with a failure", started.ended && started.projectExit !== "0", `ended ${String(started.ended)}, exit ${String(started.projectExit)}`),
      matches("the failure says where @RateLimit goes", started.stdout, /@RateLimit must be placed directly beneath its route decorator/),
    ]);
  },
};

