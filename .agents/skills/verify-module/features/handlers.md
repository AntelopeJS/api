---
covers:
  - src/server.ts
docs:
  - README.md
journeys:
  - handler-modes
  - handler-priority
  - postfix-chain
---

# Handlers

The four handler modes of [Controllers and routes](https://interfaces.antelopejs.com/docs/api/controllers#handler-modes) and their priority: a prefix that returns a value supplies the response and skips the main handler, a postfix adjusts the result and a returning postfix skips the later ones, a monitor observes success and failure and its return value is ignored.

## Sub-features

- `handler-modes`: prefix, main, postfix and monitor on one route, a prefix refusal, a monitor that sees the finished response, the error of a failing handler and a status 500, and a monitor whose HTTPResult is ignored; a prefix returning a plain string becomes the body, a prefix throwing `HTTPResult(401)` answers it and the main handler never runs, a monitor sees a thrown `HTTPResult` as `ctx.error`.
- `handler-priority`: five prefixes declared out of order run HIGHEST to LOWEST, the first that returns a value ends the chain; a prefix, postfix and monitor without a priority each run between HIGH and LOW.
- `postfix-chain`: postfixes at three priorities all run, a returning one skips the later ones, a throwing monitor changes neither the response nor the other monitors.

## How to get to it (user POV)

- `@Prefix(method, location, priority?)`, `@Postfix(...)` and `@Monitor(...)` beside a `@Get` on one controller.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" handlers
```

## Gotchas

- The docs' `@Prefix("get", "*", HandlerPriority.HIGHEST)` example matches no request on this module: `*` is a literal segment, the catch-all form is `::name`. The journeys register their prefixes on the route itself; the draft issue is `interface-api-docs-prefix-wildcard.md`.
- A prefix, postfix or monitor registered at `/users/:id` also runs for deeper paths such as `/users/boom/7`. The docs are silent, so the journeys keep their routes apart and pin nothing about it.
- Whether a postfix's returned value replaces the response is not stated by the docs; the journeys pin only that later postfixes are skipped.
