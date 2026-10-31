import type { WebSocket } from "ws";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HTTPResult } from "@antelopejs/interface-api";

import type { Awaitable } from "./thenable";

/** What a route returns: the body of the response it answers with, or an `HTTPResult`. */
export type RouteResult =
  | HTTPResult
  | ConstructorParameters<typeof HTTPResult>[1];

export type RouteCallback = (
  context: RequestContext,
) => Awaitable<RouteResult | void>;

export interface RequestContext {
  rawRequest: IncomingMessage;
  rawResponse: ServerResponse;
  url: URL;
  routeParameters: Record<string, string>;
  response: HTTPResult;
  error?: unknown;
  connection?: WebSocket;
}
