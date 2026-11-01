---
covers:
  - src/server.ts
  - src/server-factory.ts
docs:
  - README.md
journeys:
  - websocket-handlers
---

# Websocket

`@WebsocketHandler` and `@Connection` of [Controllers and routes](https://interfaces.antelopejs.com/docs/api/controllers#websocket-handlers).

## Sub-features

- `websocket-handlers`: echo both ways in order, `@Connection` on a class property, route and query parameters reach the handler, two rooms are two connections, a closed socket reaches its handler, an HTTP-only route, an unknown path and a route behind a refusing prefix are not upgraded.

## How to get to it (user POV)

- `@WebsocketHandler(location)` with `@Connection()` on a controller, reached with a WebSocket client.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" websocket
```

## Gotchas

- The client is the repository's `ws` package, run with the repository as its working directory.
