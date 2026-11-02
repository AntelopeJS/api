import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { same } from "./checks.ts";
import { status } from "./client.ts";
import { open, type Json, type Session } from "./session.ts";
import { PARAMS_SOURCE } from "./sources-params.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

async function seen(session: Session, label: string, route: string, expected: Json, headers: Record<string, string | string[]> = {}): Promise<void> {
  const reply = await session.get(`${label}: GET ${route}`, route, { headers });
  session.context.expect(reply.folder, [status(label, reply, 200), same(label, reply.json, expected)]);
}

export const parameterSources: Journey = {
  title: "@Parameter reads a route segment by default, a query value or a header; ?page and ?page= are true, a repeated query value is its first, and a missing value is undefined",
  entryPoint: "`@Parameter(name, \"param\" | \"query\" | \"header\")` on handler arguments, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: PARAMS_SOURCE });
    await seen(session, "a route segment", "/users/user123", { id: "user123", name: "Example User" });
    await seen(session, "an explicit param source", "/users/explicit/e7", { id: "e7" });
    await seen(session, "two route segments", "/users/u1/posts/p2", { userId: "u1", postId: "p2" });
    await seen(session, "a query value", "/users?page=2", { page: "2" });
    await seen(session, "a query name without a value is true", "/users?page", { page: true });
    await seen(session, "an empty query value is true", "/users?page=", { page: true });
    await seen(session, "a missing query value is undefined", "/users", {});
    await seen(session, "a repeated query value is its first", "/users?page=1&page=2", { page: "1" });
    await seen(session, "an escaped query value is decoded", "/users?page=a%20b", { page: "a b" });
    await seen(session, "a header, whatever the case of the name", "/products/headers", { tags: [], authorization: "Bearer abc", token: "tok" }, { Authorization: "Bearer abc", "X-Token": "tok" });
    await seen(session, "a missing header is undefined", "/products/headers", { tags: [] });
    await seen(session, "a route segment, a query value, a header and a list in one handler", "/products/mixed/m1?lang=fr&tag=a&tag=b", { id: "m1", lang: "fr", trace: "t-1", tags: ["a", "b"] }, { "X-Trace": "t-1" });
    await finish(session);
  },
};

export const multiParameters: Journey = {
  title: "@MultiParameter returns every query value as a list, keeps empty strings, is an empty list when nothing is sent, and takes a header as Node.js parsed it, without splitting commas",
  entryPoint: "`@MultiParameter(name, \"query\" | \"header\")` on a handler argument, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: PARAMS_SOURCE });
    await seen(session, "two query values", "/products/search?tag=js&tag=api", { tags: ["js", "api"] });
    await seen(session, "one query value", "/products/search?tag=js", { tags: ["js"] });
    await seen(session, "no query value", "/products/search", { tags: [] });
    await seen(session, "an empty query value is kept", "/products/search?tag=&tag=api", { tags: ["", "api"] });
    await seen(session, "a name without a value is an empty string", "/products/search?tag", { tags: [""] });
    await seen(session, "other query names are not collected", "/products/search?tags=x&tag=y", { tags: ["y"] });
    await seen(session, "a header value", "/products/headers", { tags: ["one"], token: "t" }, { "X-Tag": "one", "X-Token": "t" });
    await seen(session, "a missing header is an empty list", "/products/headers", { tags: [] });
    await seen(session, "a comma-separated header value is not split", "/products/headers", { tags: ["a, b"] }, { "X-Tag": "a, b" });
    await seen(session, "a repeated header keeps Node.js's joined value", "/products/headers", { tags: ["a, b"] }, { "X-Tag": ["a", "b"] });
    await finish(session);
  },
};

export const propertyParameters: Journey = {
  title: "parameter decorators on class properties fill the controller instance from each request",
  entryPoint: "`@Parameter` and `@MultiParameter` on class properties of a controller, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: PARAMS_SOURCE });
    await seen(session, "properties filled from header and query", "/config?tags=a&tags=b&scope=all", { authenticated: true, key: "k-1", appliedTags: ["a", "b"], scope: "all" }, { apiKey: "k-1" });
    await seen(session, "the next request starts from its own values", "/config?scope", { authenticated: false, appliedTags: [], scope: true });
    const body = await session.get("POST /props with a JSON body", "/props", { method: "POST", body: '{"a":1}' });
    session.context.expect(body.folder, [status("body and context decorators on properties", body, 200), same("@JSONBody, @RawBody and @Context fill the instance", body.json, { json: { a: 1 }, rawBytes: 7, method: "POST", path: "/props" })]);
    await seen(session, "two concurrent-looking requests do not share values", "/config?tags=z", { authenticated: true, key: "k-2", appliedTags: ["z"] }, { apiKey: "k-2" });
    await finish(session);
  },
};
