import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, header, status } from "./client.ts";
import { open, type Json, type Session } from "./session.ts";
import { MODIFIERS_SOURCE } from "./sources-modifiers.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

async function seen(session: Session, label: string, route: string, expected: Json, headers: Record<string, string> = {}): Promise<void> {
  const reply = await session.get(`${label}: GET ${route}`, route, { headers });
  session.context.expect(reply.folder, [status(label, reply, 200), same(label, reply.json, expected)]);
}

async function ranLog(session: Session): Promise<Json | undefined> {
  const answer = await session.run("read what ran", "return controllers.ran.splice(0);");
  return answer.value;
}

export const parameterModifiers: Journey = {
  title: "modifiers run after the provider in registration order, bottom to top with stacked decorators, each result is awaited, and a throwing modifier stops the chain before the handler runs",
  entryPoint: "`AddParameterModifier` through custom parameter decorators stacked under `@Parameter`, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: MODIFIERS_SOURCE });
    await seen(session, "the docs' EnsureNumber turns a segment into a number", "/example/21", { id: 21, doubled: 42 });
    await seen(session, "EnsureNumber turns text into 0", "/example/abc", { id: 0, doubled: 0 });
    await seen(session, "stacked decorators apply bottom to top", "/chain/order/x", { v: "x-bottom-middle-top" });
    await seen(session, "an asynchronous modifier is awaited before the next one", "/chain/async/y", { v: "y-third-second-first" });
    const refused = await session.get("GET /chain/refused/z", "/chain/refused/z");
    context.expect(refused.folder, [status("a throwing modifier", refused, 500), holds("its message reaches the client", refused.text.includes("the modifier refused z"), refused.text)]);
    context.expect(refused.folder, [same("the chain stopped at the throw and the handler never ran", await ranLog(session), ["seen:z", "refuse:z"])]);
    await finish(session);
  },
};

export const parameterTransform: Journey = {
  title: "@Transform applies a function after the provider, and a thrown HTTPResult becomes the response: 12abc, 0, -1, 007 and 1e3 are 400, a too large id is 400, a decimal id is a number",
  entryPoint: "`@Parameter(\"id\") @Transform(parseId)` on a handler argument, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: MODIFIERS_SOURCE });
    await seen(session, "a positive decimal id", "/items/42", { id: 42, type: "number" });
    await seen(session, "the largest safe integer", "/items/9007199254740991", { id: 9007199254740991, type: "number" });
    for (const value of ["12abc", "0", "-1", "007", "1e3", "1.5"]) {
      const bad = await session.get(`GET /items/${value}`, `/items/${value}`);
      context.expect(bad.folder, [status(`${value} is refused`, bad, 400), bodyIs(`${value} body`, bad, "Expected a positive integer ID")]);
    }
    const huge = await session.get("GET /items/9007199254740993", "/items/9007199254740993");
    context.expect(huge.folder, [status("an unsafe integer", huge, 400), bodyIs("an unsafe integer body", huge, "ID is too large"), holds("the thrown text is plain text", (header(huge, "content-type") ?? "").startsWith("text/plain"), String(header(huge, "content-type")))]);
    await finish(session);
  },
};

export const parameterProviders: Journey = {
  title: "SetParameterProvider supplies a handler argument from the request, a modifier runs after it, and the body provider reuses one read for every argument",
  entryPoint: "`SetParameterProvider` and `AddParameterModifier` inside `MakeParameterDecorator`, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: MODIFIERS_SOURCE });
    await seen(session, "the docs' BearerToken strips the scheme", "/providers/bearer", { token: "abc" }, { Authorization: "Bearer abc" });
    await seen(session, "a missing header gives the modifier's undefined", "/providers/bearer", {});
    await seen(session, "a provider reads the request context", "/providers/path", { urlPath: "/providers/path" });
    await seen(session, "custom decorators beside built-in ones", "/providers/combined/ada", { name: "ada", token: "t9", method: "GET" }, { Authorization: "Bearer t9" });
    const posted = await session.get("POST /providers/body", "/providers/body", { method: "POST", body: "payload" });
    context.expect(posted.folder, [status("a body provider", posted, 200), same("two arguments share the one body read", posted.json, { text: "payload", again: "payload" })]);
    await finish(session);
  },
};
