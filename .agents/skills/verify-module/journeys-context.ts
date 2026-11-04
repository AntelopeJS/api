import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { same } from "./checks.ts";
import { status } from "./client.ts";
import { open } from "./session.ts";
import { CONTEXT_SOURCE } from "./sources-context.ts";

export const requestContext: Journey = {
  title: "@Context gives the raw Node request and response, the parsed URL with the Host header, the route parameters, no body before a read and the pending read after one, the response and no error or connection on a plain request",
  entryPoint: "`@Context() ctx: RequestContext` in a POST handler, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: CONTEXT_SOURCE });
    const reply = await session.get("POST /info/42?q=a%20b", "/info/42?q=a%20b", { method: "POST", headers: { "x-probe": "p1" }, body: "ignored" });
    context.expect(reply.folder, [
      status("the handler ran", reply, 200),
      same("RequestContext as the docs table lists it", reply.json, {
        method: "POST",
        probe: "p1",
        path: "/info/42",
        search: "a b",
        isUrl: true,
        routeParameters: { id: "42" },
        bodyBefore: true,
        responseIsResult: true,
        status: 200,
        errorBefore: true,
        connection: true,
        headersSent: false,
        remote: "127.0.0.1",
      }),
    ]);
    const url = await session.get("GET /info/url with a Host header", "/info/url?q=1", { headers: { host: "example.test:81" } });
    context.expect(url.folder, [status("the handler ran", url, 200), same("ctx.url is the request URL, built from the Host header", url.json, { host: "example.test:81", href: "http://example.test:81/info/url?q=1" })]);
    const body = await session.get("POST /info/body", "/info/body", { method: "POST", body: "hello" });
    context.expect(body.folder, [status("the handler ran", body, 200), same("after a read, context.body is the pending Promise<Buffer>, and a later read keeps it", body.json, { isPromise: true, kept: true, buffer: true, text: "hello", raw: "hello" })]);
    const stopped = await session.stop();
    context.expect(stopped.folder, [interrupted(stopped)]);
  },
};
