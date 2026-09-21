import type { ConfigVars } from "@antelopejs/interface-core/config";

import { isDevMode } from "./dev-mode";
import {
  type Config,
  DEFAULT_HTTP_PORT,
  type ServerConfig,
} from "./server-config";

export const API_PORT = "API_PORT";
export const API_LOCAL_BASE_URL = "API_LOCAL_BASE_URL";
export const API_PUBLIC_BASE_URL = "API_PUBLIC_BASE_URL";

const LOOPBACK_HOST = "127.0.0.1";
const TRAILING_SLASHES = /\/+$/;

const MISSING_PUBLIC_BASE_URL_MESSAGE =
  'Missing required configuration key "publicBaseUrl" for the api module: the public origin browsers must use to reach this API (for example "https://api.example.com"). ' +
  "It is published as API_PUBLIC_BASE_URL and used for presigned asset URLs, CORS origins, redirect allowlists and e-mail links. " +
  "It is optional only in development, where it defaults to API_LOCAL_BASE_URL.";

const MISSING_SERVER_MESSAGE =
  "Unable to publish the api config variables: no server is configured.";

/**
 * Raised outside development when `publicBaseUrl` is not configured.
 */
export class MissingPublicBaseUrlError extends Error {
  override readonly name = "MissingPublicBaseUrlError";
}

function buildLocalBaseUrl(server: ServerConfig): string {
  const port = server.port ?? DEFAULT_HTTP_PORT;
  return `${server.protocol}://${LOOPBACK_HOST}:${port}`;
}

function resolvePublicBaseUrl(config: Config, localBaseUrl: string): string {
  const configured = config.publicBaseUrl?.trim();
  if (configured) {
    return configured.replace(TRAILING_SLASHES, "");
  }

  if (isDevMode()) {
    return localBaseUrl;
  }

  throw new MissingPublicBaseUrlError(MISSING_PUBLIC_BASE_URL_MESSAGE);
}

/**
 * Builds the config variables the api module publishes to the rest of the
 * project.
 *
 * Every value derives from the FIRST entry of `servers[]`, the same entry
 * the dev registry and the frontend discovery already privilege as the
 * project's canonical api endpoint.
 *
 * - `API_PORT`: the port reserved during `construct`, which is the port
 *   the server later binds.
 * - `API_LOCAL_BASE_URL`: the same-host origin, always on loopback — a
 *   configured `host` never leaks into it, so a wildcard bind
 *   (`0.0.0.0`, `::`, `[::]`) stays a reachable URL. For sidecars, health
 *   probes and gateway upstreams.
 * - `API_PUBLIC_BASE_URL`: the origin external clients must use, from the
 *   `publicBaseUrl` configuration key.
 */
export function buildConfigVars(config: Config): ConfigVars {
  const server = config.servers?.[0];
  if (!server) {
    throw new Error(MISSING_SERVER_MESSAGE);
  }

  const localBaseUrl = buildLocalBaseUrl(server);

  return {
    [API_PORT]: server.port ?? DEFAULT_HTTP_PORT,
    [API_LOCAL_BASE_URL]: localBaseUrl,
    [API_PUBLIC_BASE_URL]: resolvePublicBaseUrl(config, localBaseUrl),
  };
}
