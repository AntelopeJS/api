---
covers:
  - src/server.ts
docs:
  - README.md
journeys:
  - assert-guards
  - assert-validations
  - rate-limiting
  - rate-limit-ordering
---

# Guards

`@antelopejs/interface-api-util` served by this module, as [Validate and throttle API requests](https://interfaces.antelopejs.com/docs/api-util/introduction) documents it: `assert`, `assertValidation` and `RateLimit`, including what the module does with the thrown `HTTPResult` and with headers.

## Sub-features

- `assert-guards`: a falsy condition (`0`, `""`, `null`, `undefined`, `NaN`, `false`) throws its status and message, truthy ones (`"0"`, `[]`, `{}`, `1`) pass, the docs' greeting, 404 and 403 cases.
- `assert-validations`: a valid body, `{}`, 400 with the stringified error by default (a number, `null`, a syntax error), a given status, `errorFunc` with 422, an `errorFunc` returning `undefined` (400, empty body), and an asynchronous validator that is not converted.
- `rate-limiting`: three requests then 429 with `Retry-After`, `X-RateLimit-*` headers on allowed and rejected requests, `Reset` as UNIX seconds, a second handler with its own counter, a custom key with its message, headers kept on a replaced response, a falsy key falling back to the client IP, a forged `X-Forwarded-For` not opening a new bucket, the handler not run for a rejected request, a new window after `windowMs`.
- `rate-limit-ordering`: `@RateLimit` above `@Get` ends the project with the explanation.

## How to get to it (user POV)

- `assert(...)`, `assertValidation(...)` and `@RateLimit(limit, windowMs, options?)` in a controller.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" guards
```

## Gotchas

- `covers` lists only `src/server.ts`: the guards live in the interface package, and the module's part (turning a thrown `HTTPResult` into a response and keeping headers) is covered by [handlers](handlers.md) and [results](results.md); a change to `src/server.ts` runs this feature too through the seeded break of [results](results.md) only when its journeys are listed in `plan`.
- The rate-limit journey waits 1.7 s for a 1.5 s window.
