import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { status } from "./client.ts";
import { open, type Json, type Session } from "./session.ts";
import { BODIES_SOURCE } from "./sources-bodies.ts";

const MIB = 1024 * 1024;

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

interface Posted {
  label: string;
  route: string;
  body: string;
  expected: Json;
  headers?: Record<string, string>;
}

async function posted(session: Session, call: Posted): Promise<void> {
  const { label, route, body, expected, headers = {} } = call;
  const reply = await session.get(`${label}: POST ${route}`, route, { method: "POST", body, headers });
  session.context.expect(reply.folder, [status(label, reply, 200), same(label, reply.json, expected)]);
}

export const bodyReading: Journey = {
  title: "@RawBody is a Buffer, @JSONBody parses an object, an array, a primitive or null and is undefined for an empty body, and ReadBody keeps one pending read per request",
  entryPoint: "`@RawBody()`, `@JSONBody()` and `ReadBody(context)` in POST handlers, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: BODIES_SOURCE });
    await posted(session, { label: "a raw body", route: "/body/raw", body: "hello", expected: { isBuffer: true, bytes: 5, text: "hello" } });
    await posted(session, { label: "a multi-byte raw body counts bytes", route: "/body/raw", body: "héllo €", expected: { isBuffer: true, bytes: 10, text: "héllo €" } });
    await posted(session, { label: "an empty raw body is an empty buffer", route: "/body/raw", body: "", expected: { isBuffer: true, bytes: 0, text: "" } });
    await posted(session, { label: "a JSON object", route: "/body/json", body: '{"name":"Ada","tags":["a","b"],"n":null}', expected: { kind: "object", value: { name: "Ada", tags: ["a", "b"], n: null } }, headers: { "content-type": "application/json" } });
    await posted(session, { label: "a JSON array", route: "/body/json", body: "[1,2,3]", expected: { kind: "array", value: [1, 2, 3] } });
    await posted(session, { label: "a JSON string", route: "/body/json", body: '"text"', expected: { kind: "string", value: "text" } });
    await posted(session, { label: "a JSON number", route: "/body/json", body: "42.5", expected: { kind: "number", value: 42.5 } });
    await posted(session, { label: "a JSON boolean", route: "/body/json", body: "false", expected: { kind: "boolean", value: false } });
    await posted(session, { label: "JSON null is null, not undefined", route: "/body/json", body: "null", expected: { kind: "null" } });
    await posted(session, { label: "an empty body is undefined", route: "/body/json", body: "", expected: { kind: "undefined" } });
    const malformed = await session.get("POST malformed JSON", "/body/json", { method: "POST", body: "{not json" });
    context.expect(malformed.folder, [status("JSON syntax is checked", malformed, 400)]);
    await posted(session, { label: "ReadBody reuses one read", route: "/body/read", body: "again", expected: { unreadBefore: true, pendingAfter: true, sameBuffer: true, text: "again" } });
    await posted(session, { label: "StreamBody yields the body", route: "/body/stream-body", body: "twelve bytes", expected: { bytes: 12 } });
    await finish(session);
  },
};

interface Sized {
  label: string;
  route: string;
  bytes: number;
  code: number;
  chunked?: number;
}

async function sized(session: Session, call: Sized): Promise<void> {
  const { label, route, bytes, code, chunked } = call;
  const reply = await session.get(`${label}: ${String(bytes)} bytes to ${route}`, route, { method: "POST", bodyBytes: bytes, chunked });
  session.context.expect(reply.folder, [status(label, reply, code)]);
}

export const bodyLimits: Journey = {
  title: "buffered bodies are limited to 1 MiB by default, a larger Content-Length or more received data is 413, and a limit passed to @RawBody, @JSONBody or ReadBody replaces it",
  entryPoint: "`@RawBody(limit)`, `@JSONBody(limit)` and `ReadBody(context, limit)`, called over HTTP with bodies at and past the limit",
  async run(context) {
    const session = await open(context, { controllers: BODIES_SOURCE });
    const limit = await session.run("read the default limit", "return api.DEFAULT_REQUEST_BODY_LIMIT;");
    context.expect(limit.folder, [same("the default limit is 1 MiB", limit.value, MIB)]);
    await sized(session, { label: "exactly the default limit with a Content-Length", route: "/body/raw", bytes: MIB, code: 200 });
    await sized(session, { label: "one byte over the default limit with a Content-Length", route: "/body/raw", bytes: MIB + 1, code: 413 });
    await sized(session, { label: "exactly the default limit without a Content-Length", route: "/body/raw", bytes: MIB, code: 200, chunked: 65_536 });
    await sized(session, { label: "one byte over the default limit without a Content-Length", route: "/body/raw", bytes: MIB + 1, code: 413, chunked: 65_536 });
    await sized(session, { label: "a JSON body over the default limit", route: "/body/json", bytes: 2 * MIB, code: 413 });
    await sized(session, { label: "exactly a custom limit", route: "/body/small", bytes: 2048, code: 200 });
    await sized(session, { label: "one byte over a custom limit", route: "/body/small", bytes: 2049, code: 413 });
    await sized(session, { label: "one byte over a custom limit, chunked", route: "/body/small", bytes: 2049, code: 413, chunked: 512 });
    await sized(session, { label: "a larger custom limit accepts what the default refuses", route: "/body/upload", bytes: 2 * MIB, code: 200 });
    await sized(session, { label: "a larger custom limit still has an end", route: "/body/upload", bytes: 10 * MIB + 1, code: 413 });
    const small = await session.get("POST a JSON body over a custom JSON limit", "/body/small-json", { method: "POST", body: '{"a":"1234567890123"}' });
    context.expect(small.folder, [status("@JSONBody(limit) refuses a longer body", small, 413)]);
    const fits = await session.get("POST a JSON body within a custom JSON limit", "/body/small-json", { method: "POST", body: '{"a":"123"}' });
    context.expect(fits.folder, [status("@JSONBody(limit) accepts a shorter body", fits, 200), same("the parsed body", fits.json, { kind: "object", value: { a: "123" } })]);
    await sized(session, { label: "ReadBody(context, limit) at the limit", route: "/body/read-limit", bytes: 8, code: 200 });
    await sized(session, { label: "ReadBody(context, limit) over the limit", route: "/body/read-limit", bytes: 9, code: 413 });
    await finish(session);
  },
};

export const bodyStreaming: Journey = {
  title: "@BodyStream reads the request as it arrives with no limit, and leaving the loop early still answers the client",
  entryPoint: "`@BodyStream()` and `StreamBody(context)` in PUT and POST handlers, called over HTTP with multi-megabyte bodies",
  async run(context) {
    const session = await open(context, { controllers: BODIES_SOURCE });
    const big = await session.get("PUT 3 MiB, over the buffered limit", "/body/stream", { method: "PUT", bodyBytes: 3 * MIB, chunked: 65_536 });
    context.expect(big.folder, [status("no limit applies to a streamed body", big, 200), same("every byte arrived, in several chunks", big.json, { bytes: 3 * MIB, chunked: true })]);
    const early = await session.get("PUT 3 MiB and stop reading after the first chunk", "/body/early", { method: "PUT", bodyBytes: 3 * MIB, chunked: 65_536, thenGet: "/body/ping" });
    context.expect(early.folder, [status("the client still gets its response", early, 200), same("the handler left the loop", early.json, { left: true }), same("the rest of the body is discarded, so the same connection serves the next request", early.followUp, { status: 200, sameConnection: true })]);
    const empty = await session.get("PUT an empty body", "/body/stream", { method: "PUT", body: "" });
    context.expect(empty.folder, [status("an empty stream", empty, 200), same("zero bytes", empty.json, { bytes: 0, chunked: false })]);
    const again = await session.get("POST after the early exit", "/body/raw", { method: "POST", body: "still fine" });
    context.expect(again.folder, [status("the server keeps serving", again, 200), holds("with the new body", JSON.stringify(again.json).includes("still fine"), again.text)]);
    await finish(session);
  },
};
