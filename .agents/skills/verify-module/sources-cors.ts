export const CORS_SOURCE = String.raw`import { Controller, Get, Parameter, Post } from "@antelopejs/interface-api";

export class PingController extends Controller("/ping") {
  @Get("")
  ping() {
    return { ok: true };
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
