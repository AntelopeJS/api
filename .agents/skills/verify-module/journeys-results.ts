import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, header, headerIs, status, type Reply } from "./client.ts";
import { open, type Json, type Session } from "./session.ts";
import { RESULTS_SOURCE } from "./sources-results.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

function contentType(label: string, reply: Reply, expected: RegExp): ReturnType<typeof holds> {
  return holds(`${label}: content type`, expected.test(header(reply, "content-type") ?? ""), String(header(reply, "content-type")));
}

export const resultBodies: Journey = {
  title: "a plain object or list is JSON, a string is text/plain, HTTPResult sets status, body and content type, and an empty result is an empty body",
  entryPoint: "handler return values (objects, lists, strings, `HTTPResult`) of GET and POST routes, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: RESULTS_SOURCE });
    const json = await session.get("GET /examples/getExample", "/examples/getExample");
    context.expect(json.folder, [status("an object", json, 200), contentType("an object", json, /^application\/json/), same("an object body", json.json, { status: "success", data: [1, 2, 3] })]);
    const text = await session.get("GET /examples/text", "/examples/text");
    context.expect(text.folder, [status("a string", text, 200), contentType("a string", text, /^text\/plain/), bodyIs("a string", text, "This is a text response")]);
    const custom = await session.get("GET /examples/custom", "/examples/custom");
    context.expect(custom.folder, [status("a custom content type", custom, 200), contentType("html", custom, /^text\/html/), bodyIs("html", custom, "<h1>Hello World</h1>"), headerIs("a custom header", custom, "x-custom-header", "Custom Value")]);
    const mixed = await session.get("GET /examples/mixed", "/examples/mixed");
    context.expect(mixed.folder, [status("a list of mixed values", mixed, 200), contentType("a list", mixed, /^application\/json/), same("a list keeps every value, including null, false-like ones and nesting", mixed.json, [1, "two", { three: 3 }, null, [4], true, 0, ""])]);
    const emptyList = await session.get("GET /examples/empty-list", "/examples/empty-list");
    context.expect(emptyList.folder, [status("an empty list", emptyList, 200), same("an empty list is JSON", emptyList.json, [])]);
    const emptyObject = await session.get("GET /examples/empty-object", "/examples/empty-object");
    context.expect(emptyObject.folder, [status("an empty object", emptyObject, 200), same("an empty object is JSON", emptyObject.json, {})]);
    const emptyString = await session.get("GET /examples/empty-string", "/examples/empty-string");
    context.expect(emptyString.folder, [status("an empty string", emptyString, 200), bodyIs("an empty string", emptyString, "")]);
    const nothing = await session.get("GET /examples/nothing", "/examples/nothing");
    context.expect(nothing.folder, [status("no return value", nothing, 200), bodyIs("no return value", nothing, "")]);
    const typed = await session.get("GET /examples/object-with-type", "/examples/object-with-type");
    context.expect(typed.folder, [status("an HTTPResult with an object", typed, 200), contentType("an HTTPResult with an object", typed, /^application\/json/), same("serialised to JSON", typed.json, { message: "Success" })]);
    const missing = await session.get("GET /examples/not-found", "/examples/not-found");
    context.expect(missing.folder, [status("HTTPResult(404, text)", missing, 404), bodyIs("HTTPResult(404, text)", missing, "Not Found"), contentType("a string body", missing, /^text\/plain/)]);
    const forbidden = await session.get("GET /examples/forbidden", "/examples/forbidden");
    context.expect(forbidden.folder, [status("setStatus after new HTTPResult()", forbidden, 403), bodyIs("an empty body", forbidden, "")]);
    const created = await session.get("POST /examples/created", "/examples/created", { method: "POST" });
    context.expect(created.folder, [status("HTTPResult(201)", created, 201), same("created body", created.json, { id: "new-user-id", name: "New User" })]);
    const none = await session.get("GET /examples/no-content", "/examples/no-content");
    context.expect(none.folder, [status("HTTPResult(204)", none, 204), bodyIs("no body", none, "")]);
    await finish(session);
  },
};

export const resultHeaders: Journey = {
  title: "addHeader and removeHeader shape the response headers, withHeaders wraps a body or adds to the same HTTPResult without copying it, and peekHeaders does not create the header store",
  entryPoint: "`HTTPResult.addHeader`, `removeHeader`, `getHeaders`, `peekHeaders` and `HTTPResult.withHeaders` in handlers and in the consumer module",
  async run(context) {
    const session = await open(context, { controllers: RESULTS_SOURCE });
    const headers = await session.get("GET /examples/headers", "/examples/headers");
    context.expect(headers.folder, [headerIs("a header that was added and kept", headers, "x-rate-limit-remaining", "99"), headerIs("a header that was removed", headers, "x-rate-limit", undefined)]);
    const wrapped = await session.get("GET /examples/with-headers", "/examples/with-headers");
    context.expect(wrapped.folder, [status("withHeaders on a plain body defaults to 200", wrapped, 200), same("the plain body", wrapped.json, { message: "Success" }), headerIs("the header", wrapped, "x-request-id", "abc-123")]);
    const statused = await session.get("GET /examples/with-headers-status", "/examples/with-headers-status");
    context.expect(statused.folder, [status("its third argument sets the status of a new response", statused, 202), bodyIs("body", statused, "accepted"), headerIs("the header", statused, "x-request-id", "def-456")]);
    const existing = await session.get("GET /examples/with-headers-existing", "/examples/with-headers-existing");
    context.expect(existing.folder, [status("an existing HTTPResult keeps its status", existing, 201), same("and its body", existing.json, { data: "test" }), headerIs("and gains the header", existing, "cache-control", "no-cache")]);
    const annotated = await session.get("GET /examples/annotated", "/examples/annotated");
    context.expect(annotated.folder, [headerIs("a postfix adds a header through @Result", annotated, "x-accessed-at", "now"), same("without changing the body", annotated.json, { data: "annotated" })]);
    const replaced = await session.get("GET /examples/replaced", "/examples/replaced");
    context.expect(replaced.folder, [same("a handler that returns its own HTTPResult still has its body", replaced.json, { data: "replaced" })]);
    const pure = await session.run(
      "use HTTPResult in the consumer module",
      `const { HTTPResult } = api;
const fresh = new HTTPResult(200, "x");
const before = fresh.peekHeaders();
const afterPeek = fresh.peekHeaders();
const created = fresh.getHeaders();
const afterGet = fresh.peekHeaders();
fresh.addHeader("A", "1");
fresh.addHeader("B", "2");
fresh.removeHeader("A");
const json = new HTTPResult(200, { message: "Success" });
const html = new HTTPResult(200, "<p>HTML content</p>", "text/html");
const text = new HTTPResult(200, "Hello World");
const original = new HTTPResult(200, { data: "test" });
const same = HTTPResult.withHeaders(original, { "Cache-Control": "no-cache" });
const built = HTTPResult.withHeaders({ message: "Success" }, { "X-Request-Id": "abc-123" });
const statusOnly = new HTTPResult(404, "Not Found");
const late = new HTTPResult();
late.setStatus(403);
const reset = new HTTPResult(200, "first");
reset.setBody({ a: [1, 2] });
const typed = new HTTPResult(200);
typed.setBody("a,b", "text/csv");
const streamed = new HTTPResult();
const wasStream = streamed.isStream();
const pass = streamed.getWriteStream("application/x-ndjson", 207);
return {
  setBodyObject: [reset.getBody(), reset.getContentType()],
  setBodyTyped: [typed.getBody(), typed.getContentType()],
  streamBefore: wasStream,
  streamAfter: streamed.isStream(),
  streamStatus: streamed.getStatus(),
  streamType: streamed.getContentType(),
  streamIsWritable: typeof pass.write === "function",
  peekBefore: before === undefined,
  peekAfterPeek: afterPeek === undefined,
  getHeadersIsObject: typeof created === "object",
  peekAfterGet: afterGet !== undefined,
  headers: fresh.getHeaders(),
  jsonType: json.getContentType(),
  jsonBody: json.getBody(),
  htmlType: html.getContentType(),
  htmlBody: html.getBody(),
  textType: text.getContentType(),
  withHeadersIsSame: same === original,
  originalHeaders: original.getHeaders(),
  builtStatus: built.getStatus(),
  builtHeaders: built.getHeaders(),
  status404: statusOnly.getStatus(),
  status403: late.getStatus(),
};`,
    );
    const expected: Json = {
      peekBefore: true,
      peekAfterPeek: true,
      getHeadersIsObject: true,
      peekAfterGet: true,
      headers: { B: "2" },
      jsonType: "application/json",
      jsonBody: '{"message":"Success"}',
      htmlType: "text/html",
      htmlBody: "<p>HTML content</p>",
      textType: "text/plain",
      withHeadersIsSame: true,
      originalHeaders: { "Cache-Control": "no-cache" },
      builtStatus: 200,
      builtHeaders: { "X-Request-Id": "abc-123" },
      status404: 404,
      status403: 403,
      setBodyObject: ['{"a":[1,2]}', "application/json"],
      setBodyTyped: ["a,b", "text/csv"],
      streamBefore: false,
      streamAfter: true,
      streamStatus: 207,
      streamType: "application/x-ndjson",
      streamIsWritable: true,
    };
    context.expect(pure.folder, [holds("the scenario ran", pure.ok, JSON.stringify(pure.error)), same("HTTPResult as the docs describe it", pure.value, expected)]);
    await finish(session);
  },
};

export const resultErrors: Journey = {
  title: "a thrown HTTPResult is the response with its status and body, any other failure is a 500, and the server keeps serving afterwards",
  entryPoint: "handlers that throw an `HTTPResult`, an Error, a rejection or a string, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: RESULTS_SOURCE });
    const teapot = await session.get("GET /failures/http-result", "/failures/http-result");
    context.expect(teapot.folder, [status("a thrown HTTPResult", teapot, 418), same("keeps its JSON body", teapot.json, { error: "teapot" })]);
    const conflict = await session.get("GET /failures/text-result", "/failures/text-result");
    context.expect(conflict.folder, [status("a thrown HTTPResult with text", conflict, 409), bodyIs("keeps its text", conflict, "Conflict text")]);
    for (const route of ["error", "rejection", "string"]) {
      const failed = await session.get(`GET /failures/${route}`, `/failures/${route}`);
      context.expect(failed.folder, [status(`a handler failing with ${route}`, failed, 500)]);
    }
    const ok = await session.get("GET /failures/ok after the failures", "/failures/ok");
    context.expect(ok.folder, [status("the server keeps serving", ok, 200), same("body", ok.json, { ok: true })]);
    await finish(session);
  },
};

export const responseStreaming: Journey = {
  title: "@WriteStream and getWriteStream send chunks as they are written, with text/plain and 200 by default, a given content type and a given status",
  entryPoint: "`@WriteStream()`, `@WriteStream(\"text/event-stream\")` and `context.response.getWriteStream(type, status)`, read chunk by chunk over HTTP",
  async run(context) {
    const session = await open(context, { controllers: RESULTS_SOURCE });
    const text = await session.get("GET /stream/text", "/stream/text");
    context.expect(text.folder, [status("a stream", text, 200), contentType("the default stream type", text, /^text\/plain/), bodyIs("every written chunk, in order", text, "Starting stream\nData chunk 0\nData chunk 1\nData chunk 2\nStream complete\n")]);
    const timed = await session.get("GET /stream/timed", "/stream/timed");
    context.expect(timed.folder, [status("a stream written after the handler returned", timed, 200), bodyIs("all chunks", timed, "first\nsecond\nthird\n"), holds("the first chunk is sent before the last is written", (timed.chunks[0]?.atMs ?? 99_999) + 450 < (timed.chunks.at(-1)?.atMs ?? 0), JSON.stringify(timed.chunks.map((chunk) => chunk.atMs))), holds("the chunks arrive as separate reads", timed.chunks.length >= 3, JSON.stringify(timed.chunks.map((chunk) => chunk.text)))]);
    const events = await session.get("GET /stream/sse", "/stream/sse");
    context.expect(events.folder, [status("an event stream", events, 200), contentType("a given content type", events, /^text\/event-stream/), bodyIs("both events", events, "data: Hello\n\ndata: World\n\n"), holds("the first event is not held back until the end", (events.chunks[0]?.atMs ?? 99_999) + 250 < (events.chunks.at(-1)?.atMs ?? 0), JSON.stringify(events.chunks.map((chunk) => chunk.atMs)))]);
    const custom = await session.get("GET /stream/custom", "/stream/custom");
    context.expect(custom.folder, [status("getWriteStream(type, status)", custom, 207), contentType("its content type", custom, /^application\/x-ndjson/), bodyIs("its chunks", custom, '{"a":1}\n{"a":2}\n')]);
    const empty = await session.get("GET /stream/empty", "/stream/empty");
    context.expect(empty.folder, [status("a stream closed without writing", empty, 200), bodyIs("is an empty body", empty, "")]);
    await finish(session);
  },
};
