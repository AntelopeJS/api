export const BODIES_SOURCE = String.raw`import { BodyStream, Context, Controller, Get, JSONBody, Post, Put, RawBody, ReadBody, RequestContext, StreamBody } from "@antelopejs/interface-api";

const TEN_MIBIBYTES = 10 * 1024 * 1024;

function describe(value: unknown) {
  if (value === undefined) return { kind: "undefined" };
  if (value === null) return { kind: "null" };
  if (Array.isArray(value)) return { kind: "array", value };
  return { kind: typeof value, value };
}

export class BodyController extends Controller("/body") {
  @Post("raw")
  raw(@RawBody() body: Buffer) {
    return { isBuffer: Buffer.isBuffer(body), bytes: body.length, text: body.length < 100 ? body.toString("utf8") : undefined };
  }

  @Post("json")
  json(@JSONBody() data: unknown) {
    return describe(data);
  }

  @Post("small")
  small(@RawBody(2048) body: Buffer) {
    return { bytes: body.length };
  }

  @Post("small-json")
  smallJson(@JSONBody(16) data: unknown) {
    return describe(data);
  }

  @Post("upload")
  upload(@RawBody(TEN_MIBIBYTES) body: Buffer) {
    return { bytes: body.length };
  }

  @Put("stream")
  async stream(@BodyStream() body: AsyncIterable<Uint8Array>) {
    let bytes = 0;
    let chunks = 0;
    for await (const chunk of body) {
      bytes += chunk.byteLength;
      chunks += 1;
    }
    return { bytes, chunked: chunks > 1 };
  }

  @Get("ping")
  ping() {
    return { ok: true };
  }

  @Put("early")
  async early(@BodyStream() body: AsyncIterable<Uint8Array>) {
    let seen = 0;
    for await (const chunk of body) {
      seen = chunk.byteLength;
      break;
    }
    return { left: seen > 0 };
  }

  @Post("read")
  async read(@Context() context: RequestContext) {
    const before = context.body === undefined;
    const first = await ReadBody(context);
    const second = await ReadBody(context);
    return { unreadBefore: before, pendingAfter: context.body instanceof Promise, sameBuffer: first === second, text: first.toString("utf8") };
  }

  @Post("read-limit")
  async readLimit(@Context() context: RequestContext) {
    const body = await ReadBody(context, 8);
    return { bytes: body.length };
  }

  @Post("stream-body")
  async streamBody(@Context() context: RequestContext) {
    let bytes = 0;
    for await (const chunk of StreamBody(context)) {
      bytes += chunk.byteLength;
    }
    return { bytes };
  }
}
`;
