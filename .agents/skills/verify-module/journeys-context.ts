import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { same } from "./checks.ts";
import { status } from "./client.ts";
import { open } from "./session.ts";
import { CONTEXT_SOURCE } from "./sources-context.ts";

export const requestContext: Journey = {
  title: "@Context gives the raw Node request and response, the parsed URL, the route parameters, no body before a read, the response and no error or connection on a plain request",
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
    const stopped = await session.stop();
    context.expect(stopped.folder, [interrupted(stopped)]);
  },
};
