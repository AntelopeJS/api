export const RESULTS_SOURCE = String.raw`import { Context, Controller, Get, HTTPResult, Post, RequestContext, Result, Postfix, WriteStream } from "@antelopejs/interface-api";
import { PassThrough } from "node:stream";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ExampleController extends Controller("/examples") {
  @Get()
  getExample() {
    return { status: "success", data: [1, 2, 3] };
  }

  @Get("text")
  getTextExample() {
    return "This is a text response";
  }

  @Get("custom")
  getCustom() {
    const result = new HTTPResult(200, "<h1>Hello World</h1>", "text/html");
    result.addHeader("X-Custom-Header", "Custom Value");
    return result;
  }

  @Get("mixed")
  mixed() {
    return [1, "two", { three: 3 }, null, [4], true, 0, ""];
  }

  @Get("nothing")
  nothing() {}

  @Get("empty-list")
  emptyList() {
    return [];
  }

  @Get("empty-object")
  emptyObject() {
    return {};
  }

  @Get("empty-string")
  emptyString() {
    return "";
  }

  @Get("object-with-type")
  objectWithType() {
    return new HTTPResult(200, { message: "Success" });
  }

  @Get("not-found")
  notFound() {
    return new HTTPResult(404, "Not Found");
  }

  @Get("forbidden")
  forbidden() {
    const result = new HTTPResult();
    result.setStatus(403);
    return result;
  }

  @Post("created")
  created() {
    return new HTTPResult(201, { id: "new-user-id", name: "New User" });
  }

  @Get("no-content")
  noContent() {
    return new HTTPResult(204);
  }

  @Get("headers")
  headers() {
    const result = new HTTPResult(200, "Success");
    result.addHeader("X-Rate-Limit", "100");
    result.addHeader("X-Rate-Limit-Remaining", "99");
    result.removeHeader("X-Rate-Limit");
    return result;
  }

  @Get("with-headers")
  withHeaders() {
    return HTTPResult.withHeaders({ message: "Success" }, { "X-Request-Id": "abc-123" });
  }

  @Get("with-headers-status")
  withHeadersStatus() {
    return HTTPResult.withHeaders("accepted", { "X-Request-Id": "def-456" }, 202);
  }

  @Get("with-headers-existing")
  withHeadersExisting() {
    const original = new HTTPResult(201, { data: "test" });
    return HTTPResult.withHeaders(original, { "Cache-Control": "no-cache" }, 500);
  }

  @Get("annotated")
  annotated() {
    return { data: "annotated" };
  }

  @Postfix("get", "annotated")
  annotate(@Result() result: HTTPResult) {
    result.addHeader("X-Accessed-At", "now");
  }

  @Get("replaced")
  replaced() {
    return new HTTPResult(200, { data: "replaced" });
  }

  @Postfix("get", "replaced")
  annotateReplaced(@Result() result: HTTPResult) {
    result.addHeader("X-Annotated", "yes");
  }
}

export class FailureController extends Controller("/failures") {
  @Get("http-result")
  httpResult() {
    throw new HTTPResult(418, { error: "teapot" });
  }

  @Get("text-result")
  textResult() {
    throw new HTTPResult(409, "Conflict text");
  }

  @Get("error")
  error() {
    throw new Error("plain failure");
  }

  @Get("rejection")
  async rejection() {
    await pause(10);
    throw new Error("late failure");
  }

  @Get("string")
  thrownString() {
    throw "just a string";
  }

  @Get("ok")
  ok() {
    return { ok: true };
  }
}

export class StreamController extends Controller("/stream") {
  @Get("text")
  async streamData(@Context() context: RequestContext, @WriteStream() stream: PassThrough) {
    stream.write("Starting stream\n");
    for (let i = 0; i < 3; i++) {
      await pause(50);
      stream.write("Data chunk " + i + "\n");
    }
    stream.end("Stream complete\n");
    return context.response;
  }

  @Get("timed")
  async timed(@Context() context: RequestContext, @WriteStream() stream: PassThrough) {
    stream.write("first\n");
    setTimeout(() => stream.write("second\n"), 300);
    setTimeout(() => stream.end("third\n"), 700);
    return context.response;
  }

  @Get("sse")
  async events(@Context() context: RequestContext, @WriteStream("text/event-stream") stream: PassThrough) {
    stream.write("data: Hello\n\n");
    setTimeout(() => {
      stream.write("data: World\n\n");
      stream.end();
    }, 400);
    return context.response;
  }

  @Get("custom")
  async custom(@Context() context: RequestContext) {
    const stream = context.response.getWriteStream("application/x-ndjson", 207);
    stream.write('{"a":1}\n');
    setTimeout(() => stream.end('{"a":2}\n'), 200);
    return context.response;
  }

  @Get("empty")
  async empty(@Context() context: RequestContext, @WriteStream() stream: PassThrough) {
    setTimeout(() => stream.end(), 100);
    return context.response;
  }
}
`;
