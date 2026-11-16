---
covers:
  - src/server.ts
  - src/server-factory.ts
docs:
  - README.md
journeys:
  - websocket-handlers
  - secure-websocket
  - websocket-refusals
---

# Websocket

`@WebsocketHandler` and `@Connection` of [Controllers and routes](https://interfaces.antelopejs.com/docs/api/controllers#websocket-handlers).

## Sub-features

- `secure-websocket`: an https server (beside an http one) upgrades WebSockets: a `wss://` client gets its messages echoed in order and reaches a route with its parameters, as the http server does.
- `websocket-handlers`: echo both ways in order, `@Connection` on a class property, route and query parameters reach the handler, two rooms are two connections, a closed socket reaches its handler, an HTTP-only route, an unknown path and a route behind a refusing prefix are not upgraded. A plain GET (no Upgrade header) on a WebSocket route is 404 `Not Found` and runs no handler.
- `websocket-refusals`: a `ws` client whose upgrade is refused gets the HTTP answer, not `socket hang up` with code 1006: a prefix that returns a 403 or a 418, one that throws, an asynchronous one that throws and an unknown path answer their status and body with `Connection: close`, no refused handler runs, and an upgrade nothing refuses still echoes afterwards.

## How to get to it (user POV)

- `@WebsocketHandler(location)` with `@Connection()` on a controller, reached with a WebSocket client.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" websocket
```

## Gotchas

- The client is the repository's `ws` package, run with the repository as its working directory.
