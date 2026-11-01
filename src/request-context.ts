import type { WebSocket } from "ws";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HTTPBody, HTTPResult } from "@antelopejs/interface-api";

import type { Awaitable } from "./thenable";

/** What a route returns: the body of the response it answers with, an `HTTPResult`, or nothing. */
export type RouteResult = HTTPResult | HTTPBody | undefined | void;

export type RouteCallback = (context: RequestContext) => Awaitable<RouteResult>;

export interface RequestContext {
  rawRequest: IncomingMessage;
  rawResponse: ServerResponse;
  url: URL;
  routeParameters: Record<string, string>;
  response: HTTPResult;
  error?: unknown;
  connection?: WebSocket;
}
