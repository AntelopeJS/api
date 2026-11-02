export const CONTEXT_SOURCE = String.raw`import { Context, Controller, Get, HTTPResult, Post, RawBody, ReadBody, RequestContext } from "@antelopejs/interface-api";

export class InfoController extends Controller("/info") {
  @Post(":id")
  inspect(@Context() ctx: RequestContext) {
    return {
      method: ctx.rawRequest.method,
      probe: ctx.rawRequest.headers["x-probe"],
      path: ctx.url.pathname,
      search: ctx.url.searchParams.get("q"),
      isUrl: ctx.url instanceof URL,
      routeParameters: ctx.routeParameters,
      bodyBefore: ctx.body === undefined,
      responseIsResult: ctx.response instanceof HTTPResult,
      status: ctx.response.getStatus(),
      errorBefore: ctx.error === undefined,
      connection: ctx.connection === undefined,
      headersSent: ctx.rawResponse.headersSent,
      remote: ctx.rawRequest.socket.remoteAddress,
    };
  }

  @Get("url")
  url(@Context() ctx: RequestContext) {
    return { host: ctx.url.host, href: ctx.url.href };
  }

  @Post("body")
  async body(@Context() ctx: RequestContext, @RawBody() raw: Buffer) {
    const pending = ctx.body;
    void ReadBody(ctx);
    const kept = ctx.body === pending;
    const resolved = await pending;
    return { isPromise: pending instanceof Promise, kept, buffer: Buffer.isBuffer(resolved), text: Buffer.isBuffer(resolved) ? resolved.toString() : null, raw: raw.toString() };
  }
}
`;
