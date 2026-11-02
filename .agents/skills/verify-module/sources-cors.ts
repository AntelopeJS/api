export const CORS_SOURCE = String.raw`import { Controller, Get, Post } from "@antelopejs/interface-api";

export class PingController extends Controller("/ping") {
  @Get("")
  ping() {
    return { ok: true };
  }

  @Post("")
  create() {
    return { created: true };
  }
}
`;
