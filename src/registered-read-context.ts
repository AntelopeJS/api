import { HTTPResult } from "@antelopejs/interface-api";
import { IncomingMessage, ServerResponse } from "node:http";

import type { RequestContext } from "./server";

const FORBIDDEN = 403;

const BODY_HEADERS = new Set(["content-length", "transfer-encoding"]);
const HEADER_PAIR_LENGTH = 2;
const readSignals = new WeakMap<RequestContext, AbortSignal>();

export interface RegisteredReadContext extends RequestContext {
  signal: AbortSignal;
}

export function assertReadActive(context: RequestContext): void {
  readSignals.get(context)?.throwIfAborted();
}

class ReadRequest extends IncomingMessage {
  constructor(
    parent: IncomingMessage,
    private readonly abort: () => void,
  ) {
    super(parent.socket);
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    if (error || !this.readableEnded) this.abort();
    callback(null);
  }
}

class ReadResponse extends ServerResponse {
  constructor(
    request: IncomingMessage,
    private readonly abort: () => void,
  ) {
    super(request);
  }

  override write(): boolean {
    this.abort();
    return false;
  }
  override end(): this {
    this.abort();
    return this;
  }
  override writeHead(): this {
    this.abort();
    return this;
  }
  override flushHeaders(): void {
    this.abort();
  }
  override destroy(): this {
    this.abort();
    return this;
  }
  override writeContinue(): void {
    this.abort();
  }
  override writeProcessing(): void {
    this.abort();
  }
  override writeEarlyHints(): void {
    this.abort();
  }
}

function readUrl(origin: string, pathname: string): URL {
  const url = new URL(pathname, origin);
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    url.origin !== origin ||
    url.pathname !== pathname ||
    url.search ||
    url.hash
  ) {
    throw new HTTPResult(FORBIDDEN, "Invalid registered read path");
  }
  return url;
}

function copyHeaders(parent: IncomingMessage, request: IncomingMessage): void {
  request.headers = Object.fromEntries(
    Object.entries(parent.headers)
      .filter(([name]) => !BODY_HEADERS.has(name.toLowerCase()))
      .map(([name, value]) => [
        name,
        Array.isArray(value) ? [...value] : value,
      ]),
  );
  request.headersDistinct = Object.fromEntries(
    Object.entries(parent.headersDistinct)
      .filter(([name]) => !BODY_HEADERS.has(name.toLowerCase()))
      .map(([name, values]) => [name, values && [...values]]),
  );
  request.rawHeaders = [];
  for (
    let index = 0;
    index < parent.rawHeaders.length;
    index += HEADER_PAIR_LENGTH
  ) {
    const name = parent.rawHeaders[index];
    if (!BODY_HEADERS.has(name.toLowerCase())) {
      request.rawHeaders.push(name, parent.rawHeaders[index + 1]);
    }
  }
}

export function createReadContext(
  parent: RequestContext,
  pathname: string,
): RegisteredReadContext {
  const url = readUrl(parent.url.origin, pathname);
  const controller = new AbortController();
  const abort = () =>
    controller.abort(new HTTPResult(FORBIDDEN, "Registered read interrupted"));
  const request = new ReadRequest(parent.rawRequest, abort);
  request.method = "GET";
  request.url = pathname;
  request.httpVersion = parent.rawRequest.httpVersion;
  request.httpVersionMajor = parent.rawRequest.httpVersionMajor;
  request.httpVersionMinor = parent.rawRequest.httpVersionMinor;
  copyHeaders(parent.rawRequest, request);
  request.complete = true;
  request.push(null);
  const context: RegisteredReadContext = {
    rawRequest: request,
    rawResponse: new ReadResponse(request, abort),
    url,
    routeParameters: {},
    response: new HTTPResult(),
    signal: controller.signal,
  };
  readSignals.set(context, controller.signal);
  return context;
}

export async function completeRead(
  context: RegisteredReadContext,
  run: () => Promise<HTTPResult>,
): Promise<HTTPResult> {
  let rejectRead: (reason: unknown) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectRead = reject;
  });
  const onAbort = () => rejectRead(context.signal.reason);
  context.signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([run(), interrupted]);
  } finally {
    context.signal.removeEventListener("abort", onAbort);
  }
}
