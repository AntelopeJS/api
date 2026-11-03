export const CORS_SOURCE = String.raw`import { Context, Controller, Get, Parameter, Post, RequestContext } from "@antelopejs/interface-api";

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

  @Post("")
  create() {
    return { created: true };
  }
}
`;
