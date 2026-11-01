---
covers:
  - src/request-context.ts
  - src/implementations/api/index.ts
docs:
  - README.md
journeys:
  - body-reading
  - body-limits
  - body-streaming
  - request-context
---

# Bodies

Request bodies and the request context of [Request bodies and responses](https://interfaces.antelopejs.com/docs/api/http-handling): raw, JSON and streamed bodies, the 1 MiB default limit and the limits passed to the decorators, and the `RequestContext` table.

## Sub-features

- `body-reading`: `@RawBody` is a Buffer (multi-byte text counts bytes, an empty body is empty), `@JSONBody` parses an object, a list, a string, a number, a boolean and `null`, is `undefined` for an empty body, malformed JSON is 400, `ReadBody` reuses one read, `StreamBody` yields the body.
- `body-limits`: exactly 1 MiB passes and one byte more is 413, with and without a `Content-Length`, a custom limit on `@RawBody`, `@JSONBody` and `ReadBody` replaces the default in both directions, and 10 MiB+1 still ends.
- `body-streaming`: `@BodyStream` takes 3 MiB with no limit in several chunks, leaving the loop early still answers, an empty stream, and the server keeps serving.
- `request-context`: `@Context` exposes the raw request and response, the parsed URL, the route parameters, no body before a read, the response, and no error or connection.

## How to get to it (user POV)

- `@RawBody(limit?)`, `@JSONBody(limit?)`, `@BodyStream()`, `ReadBody(context, limit?)`, `StreamBody(context)` and `@Context()`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" bodies
```

## Gotchas

- The client of these journeys keeps the connection alive: with `Connection: close` Node closes the socket right after an early response, which a client still writing sees as EPIPE, not as the missing response.
- The 400 for malformed JSON is the module's behaviour; the docs say only that syntax is checked.
