---
covers:
  - src/server.ts
docs:
  - README.md
journeys:
  - result-bodies
  - result-headers
  - result-errors
  - response-streaming
---

# Results

What a handler returns and what the client receives, from [Request bodies and responses](https://interfaces.antelopejs.com/docs/api/http-handling): plain values, `HTTPResult`, headers, `withHeaders`, thrown results, streaming responses.

## Sub-features

- `result-bodies`: an object, a list of mixed values (null, false-like values, nesting), empty list, empty object, empty string and no return value, a string is text/plain, `HTTPResult` with a status, an object, a content type, `setStatus`, 201 and 204.
- `result-headers`: `addHeader`, `removeHeader`, `withHeaders` on a plain body, with a status and on an existing result (same object, status kept), a postfix's `@Result` header, and the pure `HTTPResult` methods (`getHeaders`, `peekHeaders`, `setBody`, `getContentType`, `isStream`, `getWriteStream`).
- `result-errors`: a thrown `HTTPResult` is the response, a thrown Error, a rejection and a thrown string are 500, the server keeps serving.
- `response-streaming`: `@WriteStream()` defaults to text/plain and 200, `@WriteStream("text/event-stream")`, `getWriteStream(type, status)`, a stream written after the handler returned arrives in separate reads before it ends, an empty stream.

## How to get to it (user POV)

- Handlers returning values, `HTTPResult`, or `context.response` after writing to `@WriteStream()`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" results
```

## Gotchas

- The docs' first streaming example awaits its whole loop before returning `context.response`, so nothing is sent until the loop ends. The journeys check its final body, and check timing only on a stream whose handler returns first; the draft issue is `interface-api-docs-streaming-example.md`.
- The body of a 500 is not named by the docs and is not pinned.
