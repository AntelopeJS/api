import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { Events } from "@antelopejs/interface-core/modules";

/** Answers 200 whatever the gate says, so a slow start is not taken for a dead process. */
const LIVENESS_PATH = "/_live";

const STARTING_STATUS = 503;
const STARTING_BODY = "error.server_starting";
const RETRY_AFTER_SECONDS = "1";
const LIVE_STATUS = 200;
const LIVE_BODY = "ok";

let isOpen = false;

function open(): void {
  isOpen = true;
}

function close(): void {
  isOpen = false;
}

/**
 * Follows the core lifecycle (`Events.ModulesStarted` / `ModulesStopping`,
 * emitted by `@antelopejs/core` 1.17 and later): requests are served once
 * every module has started, and answered 503 again from the moment modules
 * start stopping.
 */
export function watchModulesLifecycle(): void {
  Events.ModulesStarted.register(open);
  Events.ModulesStopping.register(close);
}

export function unwatchModulesLifecycle(): void {
  Events.ModulesStarted.unregister(open);
  Events.ModulesStopping.unregister(close);
  close();
}

/**
 * The response the gate gives instead of routing the request: `/_live`
 * always, and `503` with `Retry-After` for every other request while the
 * project is starting or stopping. Nothing has run for that request, so the
 * client can safely retry it.
 */
export function gateResponse(
  requestContext: RequestContext,
): HTTPResult | undefined {
  if (requestContext.url.pathname === LIVENESS_PATH) {
    return new HTTPResult(LIVE_STATUS, LIVE_BODY);
  }
  if (isOpen) {
    return undefined;
  }
  const response = new HTTPResult(STARTING_STATUS, STARTING_BODY);
  response.addHeader("Retry-After", RETRY_AFTER_SECONDS);
  return response;
}
