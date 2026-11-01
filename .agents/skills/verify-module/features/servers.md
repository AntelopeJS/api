---
covers:
  - src/index.ts
  - src/port-binding.ts
  - src/port-listener.ts
  - src/server-config.ts
  - src/server-origin.ts
  - src/server-factory.ts
  - src/dev-mode.ts
  - src/dev-registry.ts
docs:
  - README.md
journeys:
  - server-ports
  - port-fallback
  - server-protocols
  - server-options
  - dev-registry
  - listen-on-demand
  - production-boot
---

# Servers

`servers`, `publicBaseUrl`, `strictPort` and `autoListen` of README.md: which sockets the module binds, which one the config variables describe, and what changes outside development.

## Sub-features

- `server-ports`: two HTTP servers serve the same routes, port 0 binds a free port that `API_PORT` reports, the variables describe the first server, `publicBaseUrl` loses its trailing slashes.
- `port-fallback`: in development a busy port falls back to a free one that `API_PORT` reports and the log says which port it left, and `strictPort` fails the boot instead.
- `server-protocols`: an https server (a generated certificate) beside an http one, the https port refuses plain http, the variables follow the first server's protocol.
- `server-options`: keys other than protocol, host and port reach the Node.js server: `maxHeaderSize` on one server refuses 4 KiB of headers with 431 while the other accepts them.
- `dev-registry`: the servers are recorded in `.antelope/dev.json` with a wildcard host as loopback, the protocol and the bound port, and the file is removed when the project stops.
- `listen-on-demand`: `autoListen: false` serves nothing until `Listen()`.
- `production-boot`: `ajs project build` then `start`: the boot fails without `publicBaseUrl` and says so, binds the exact port (a busy one is a failure, not a fallback), publishes `publicBaseUrl` without its slash, and sends no CORS header without a `cors` config.

## How to get to it (user POV)

- `servers`, `publicBaseUrl`, `strictPort`, `autoListen` in the module's `config`, and `${@api.API_PORT}` in another module's.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" servers
```

## Gotchas

- A busy port is held by the journey itself with `node:net`, then released. The fallback warning is the module's own message (`Port N in use, listening on ... instead`); the docs say only that the module falls back.
- Production runs without the pack's driver module, which needs `ajs project dev`'s environment; the consumer module reads the variables.
- Not reached: the default port 80 (needs privileges; `config-variables` covers the default as a value), `ajs project modules add` writing the default configuration, and a stop that closes the sockets.
