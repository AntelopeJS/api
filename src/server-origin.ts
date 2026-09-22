import { DEFAULT_HTTP_PORT, type ServerConfig } from "./server-config";

/**
 * The single spelling under which this module advertises itself on the
 * local machine, used by the dev registry and by the published config
 * variables alike.
 *
 * `127.0.0.1` is preferred over `localhost` because it is unambiguous:
 * `localhost` goes through the resolver, which may answer `::1` first,
 * and a server bound to an IPv4 wildcard (`host: "0.0.0.0"`) does not
 * answer there at all. The dev registry published `localhost` before;
 * the change stays inside this repository, because the consumer that
 * reads it — the frontend discovery — preserves an explicit host
 * verbatim and only rewrites wildcards, which never reach it anymore.
 *
 * What matters more than the choice itself is that there is exactly one
 * answer to "where is this server": a browser treats `localhost` and
 * `127.0.0.1` as distinct origins, so advertising the API under one and
 * its assets under the other costs a second preflight and a second
 * cookie jar.
 */
export const LOOPBACK_HOST = "127.0.0.1";

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);
const IPV6_SEPARATOR = ":";
const IPV6_BRACKET_START = "[";

/**
 * Maps a bind host to a connectable URL host:
 *
 * - an absent or wildcard host (`0.0.0.0`, `::`, `[::]`) is not a
 *   connectable address, and becomes loopback;
 * - any explicit host is preserved verbatim, because a server bound to
 *   it does not listen on loopback at all;
 * - a bare IPv6 literal is bracketed, as a URL requires.
 */
export function buildUrlHost(host?: string): string {
  if (!host || WILDCARD_HOSTS.has(host)) {
    return LOOPBACK_HOST;
  }

  if (host.includes(IPV6_SEPARATOR) && !host.startsWith(IPV6_BRACKET_START)) {
    return `[${host}]`;
  }

  return host;
}

/**
 * Builds the origin this module advertises for a configured server.
 */
export function buildServerOrigin(
  config: ServerConfig,
  port: number = config.port ?? DEFAULT_HTTP_PORT,
): string {
  return `${config.protocol}://${buildUrlHost(config.host)}:${port}`;
}
