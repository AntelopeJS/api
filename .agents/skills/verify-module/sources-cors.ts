export const CORS_SOURCE = String.raw`import { Context, Controller, Get, HTTPResult, Parameter, Post, RequestContext } from "@antelopejs/interface-api";

export class PingController extends Controller("/ping") {
  @Get("")
  ping() {
    return { ok: true };
  }

  @Get("scheme")
  scheme(@Context() context: RequestContext) {
    return { protocol: context.url.protocol };
  }

  @Get("agent")
  agent(@Parameter("user-agent", "header") agent: string | undefined) {
    return { agent };
  }

  @Get("created")
  created() {
    return new HTTPResult(201, { created: true });
  }

  @Get("refused")
  refused() {
    throw new HTTPResult(403, "refused");
  }

  @Get("broken")
  broken() {
    throw new Error("broken");
  }

  @Post("")
  create() {
    return { created: true };
  }
}
`;
