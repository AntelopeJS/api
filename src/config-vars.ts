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
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);
const IPV6_SEPARATOR = ":";
const IPV6_BRACKET_START = "[";
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

/**
 * Maps a bind host to a connectable URL host, mirroring the convention
 * `dms-frontend/src/discovery.ts` already applies to the dev registry
 * endpoints, so the ecosystem keeps a single rule:
 *
 * - an absent or wildcard host (`0.0.0.0`, `::`, `[::]`) is not a
 *   connectable address, and becomes loopback;
 * - any explicit host is preserved verbatim, because a server bound to
 *   it does not listen on loopback at all;
 * - a bare IPv6 literal is bracketed, as a URL requires.
 */
function buildUrlHost(host?: string): string {
  if (!host || WILDCARD_HOSTS.has(host)) {
    return LOOPBACK_HOST;
  }

  if (host.includes(IPV6_SEPARATOR) && !host.startsWith(IPV6_BRACKET_START)) {
    return `[${host}]`;
  }

  return host;
}

function buildLocalBaseUrl(server: ServerConfig): string {
  const port = server.port ?? DEFAULT_HTTP_PORT;
  return `${server.protocol}://${buildUrlHost(server.host)}:${port}`;
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
 * - `API_PORT`: the port reserved during `provide`, which is the port the
 *   server later binds.
 * - `API_LOCAL_BASE_URL`: the same-host origin. Its host follows the
 *   `buildUrlHost` convention: an absent or wildcard bind host becomes
 *   loopback, an explicit host is preserved. For sidecars, health probes
 *   and gateway upstreams.
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
