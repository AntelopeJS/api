import type { Check, JourneyContext } from "@antelopejs/tooling-configs/verify";

import { isNumber, isString, parseJson, pick, recordOf, type Json } from "./json.ts";

/** One request a journey sends with Node's `http` client, so headers, raw bodies and chunk timing are the journey's choice. */
export interface RequestSpec {
  url: string;
  method?: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  /** Sends this many bytes of `a`. */
  bodyBytes?: number;
  /** Sends the body in `bodyBytes` as chunks of this size without a Content-Length. */
  chunked?: number;
  /** Aborts the request after this many milliseconds, once the response head arrived. */
  abortAfterMs?: number;
  timeoutMs?: number;
}

/** What the client saw. */
export interface Reply {
  folder: string;
  status: number | null;
  headers: Map<string, string | string[]>;
  text: string;
  json: Json | undefined;
  chunks: { atMs: number; text: string }[];
  error: string | null;
}

const SCRIPT = String.raw`const spec = JSON.parse(process.argv[1]);
const url = new URL(spec.url);
const http = require(url.protocol === "https:" ? "node:https" : "node:http");
const started = Date.now();
const out = { status: null, headers: {}, text: "", chunks: [], error: null };
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  console.log(JSON.stringify(out));
  process.exit(0);
}
const headers = { ...(spec.headers || {}) };
const payload = spec.bodyBytes !== undefined ? null : spec.body !== undefined ? Buffer.from(spec.body) : null;
if (payload && headers["content-length"] === undefined && headers["Content-Length"] === undefined) headers["content-length"] = String(payload.length);
if (spec.bodyBytes !== undefined && spec.chunked === undefined) headers["content-length"] = String(spec.bodyBytes);
const request = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: spec.method || "GET", headers, agent: new http.Agent({ keepAlive: true, rejectUnauthorized: false }) }, (response) => {
  out.status = response.statusCode;
  for (const [name, value] of Object.entries(response.headers)) out.headers[name] = value;
  response.setEncoding("utf8");
  response.on("data", (data) => {
    out.text += data;
    out.chunks.push({ atMs: Date.now() - started, text: data });
  });
  response.on("end", finish);
  response.on("error", (error) => { out.error = String(error.message); finish(); });
  response.on("aborted", () => { out.error = "aborted"; finish(); });
  if (spec.abortAfterMs !== undefined) setTimeout(() => { out.error = "client aborted"; request.destroy(); finish(); }, spec.abortAfterMs);
});
request.on("error", (error) => { if (out.status === null) out.error = error.code + " " + error.message + " after " + (Date.now() - started) + " ms"; finish(); });
request.setTimeout(spec.timeoutMs || 20000, () => { out.error = "timeout"; request.destroy(); finish(); });
if (spec.bodyBytes !== undefined) {
  const total = spec.bodyBytes;
  const size = spec.chunked || total;
  let sent = 0;
  const pump = () => {
    while (sent < total) {
      const piece = Buffer.alloc(Math.min(size, total - sent), 97);
      sent += piece.length;
      if (!request.write(piece)) { request.once("drain", pump); return; }
    }
    request.end();
  };
  pump();
} else if (payload) request.end(payload);
else request.end();
`;

function headerMap(value: Json | undefined): Map<string, string | string[]> {
  const map = new Map<string, string | string[]>();
  for (const [name, entry] of Object.entries(recordOf(value))) {
    if (isString(entry)) map.set(name, entry);
    else if (Array.isArray(entry)) map.set(name, entry.filter(isString));
  }
  return map;
}

function chunkList(value: Json | undefined): { atMs: number; text: string }[] {
  const chunks: { atMs: number; text: string }[] = [];
  if (!Array.isArray(value)) return chunks;
  for (const entry of value) {
    const atMs = pick(entry, "atMs");
    const text = pick(entry, "text");
    if (isNumber(atMs) && isString(text)) chunks.push({ atMs, text });
  }
  return chunks;
}

/** Sends the request from a Node process and records it as one evidence step. */
export async function send(context: JourneyContext, name: string, spec: RequestSpec): Promise<Reply> {
  const ran = await context.command(name, "node", ["-e", SCRIPT, JSON.stringify(spec)]);
  const parsed = parseJson(ran.stdout.trim().split("\n").pop() ?? "");
  if (parsed === undefined || parsed === null) {
    context.notVerified(`the request client printed no result: ${ran.stderr.slice(0, 200)}`);
  }
  const status = pick(parsed, "status");
  const body = pick(parsed, "text");
  const text = isString(body) ? body : "";
  const failure = pick(parsed, "error");
  return {
    folder: ran.folder,
    status: isNumber(status) ? status : null,
    headers: headerMap(pick(parsed, "headers")),
    text,
    json: parseJson(text),
    chunks: chunkList(pick(parsed, "chunks")),
    error: isString(failure) ? failure : ran.exitCode === 0 ? null : ran.stderr.slice(0, 200),
  };
}

/** The first value of a response header, or `undefined`. */
export function header(reply: Reply, name: string): string | undefined {
  const value = reply.headers.get(name.toLowerCase());
  return Array.isArray(value) ? value[0] : value;
}

/** A check that the reply has this status. */
export function status(label: string, reply: Reply, expected: number): Check {
  return { name: `${label}: status ${expected}`, pass: reply.status === expected, detail: `status ${String(reply.status)}, error ${String(reply.error)}, body ${reply.text.slice(0, 120)}` };
}

/** A check that a response header equals `expected`; `undefined` means the header must be absent. */
export function headerIs(label: string, reply: Reply, name: string, expected: string | undefined): Check {
  const actual = header(reply, name);
  return { name: `${label}: header ${name}`, pass: actual === expected, detail: `expected ${String(expected)}, got ${String(actual)}` };
}

/** A check that the body text equals `expected`. */
export function bodyIs(label: string, reply: Reply, expected: string): Check {
  return { name: `${label}: body`, pass: reply.text === expected, detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(reply.text.slice(0, 200))}` };
}
