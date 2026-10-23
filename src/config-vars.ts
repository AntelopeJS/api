import type { ConfigVars } from "@antelopejs/interface-core/config";

import { buildServerOrigin } from "./server-origin";
import { type Config, DEFAULT_HTTP_PORT } from "./server-config";

export const API_PORT = "API_PORT";
export const API_LOCAL_BASE_URL = "API_LOCAL_BASE_URL";
export const API_PUBLIC_BASE_URL = "API_PUBLIC_BASE_URL";

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

function configuredPublicBaseUrl(config: Config): string | undefined {
  return (
    config.publicBaseUrl?.trim().replace(TRAILING_SLASHES, "") || undefined
  );
}

/**
 * Refuses a missing `publicBaseUrl` outside development, where browsers
 * cannot reach the API at its local origin. `provide` checks it before
 * publishing; `configVars` itself stays pure and falls back to the local
 * origin, so a build that reads the variables without running the module
 * (`ajs dms build` in an image without the deployment's variables) does not
 * need it.
 */
export function assertPublicBaseUrl(config: Config, isDev: boolean): void {
  if (isDev || configuredPublicBaseUrl(config)) {
    return;
  }

  throw new MissingPublicBaseUrlError(MISSING_PUBLIC_BASE_URL_MESSAGE);
}

/**
 * The config variables the api module publishes to the rest of the
 * project, computed from its configuration alone.
 *
 * `provide` publishes them once it has bound the ports, and the package
 * declares this file as `antelopeJs.configVarsFile`, so tools that read the
 * project without running it (`ajs dms build`) resolve
 * `${@api.<VAR>}` from this very function.
 *
 * Every value derives from the FIRST entry of `servers[]`, the same entry
 * the dev registry and the frontend discovery already privilege as the
 * project's canonical api endpoint.
 *
 * - `API_PORT`: the server's port. `provide` calls this with the port it
 *   reserved, which is the port the server later binds.
 * - `API_LOCAL_BASE_URL`: the same-host origin, built with
 *   `buildServerOrigin` — the very helper the dev registry endpoints go
 *   through, so both always name the server the same way. For sidecars,
 *   health probes and gateway upstreams.
 * - `API_PUBLIC_BASE_URL`: the origin external clients must use, from the
 *   `publicBaseUrl` configuration key, else the local origin.
 */
export function configVars(config: Config): ConfigVars {
  const server = config.servers?.[0];
  if (!server) {
    throw new Error(MISSING_SERVER_MESSAGE);
  }

  const localBaseUrl = buildServerOrigin(server);

  return {
    [API_PORT]: server.port ?? DEFAULT_HTTP_PORT,
    [API_LOCAL_BASE_URL]: localBaseUrl,
    [API_PUBLIC_BASE_URL]: configuredPublicBaseUrl(config) ?? localBaseUrl,
  };
}
