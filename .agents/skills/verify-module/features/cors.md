---
covers:
  - src/middlewares/cors.ts
  - src/module-config.ts
docs:
  - README.md
journeys:
  - cors-config
  - cors-defaults
  - cors-runtime
---

# Cors

The CORS policy of README.md and of [Request bodies and responses](https://interfaces.antelopejs.com/docs/api/http-handling#cors-configuration): `cors` in the module config, the defaults, loopback origins in development, and `SetCorsConfig` / `GetCorsConfig` at run time.

## Sub-features

- `cors-config`: listed origins (two of them), methods, static headers that win over the requested ones, credentials, max age, an unlisted origin, a longer look-alike, another scheme, four loopback origins allowed in development and three look-alikes refused, ordinary requests.
- `cors-defaults`: only `allowedOrigins` as a string: default methods `GET,HEAD,PUT,PATCH,POST,DELETE`, credentials on, requested headers reflected, no max age.
- `cors-runtime`: `SetCorsConfig` replaces the policy without a restart, a `RegExp` and a mixed list of string and `RegExp`, credentials false drops the header, a max age of 0 is sent, `GetCorsConfig` returns what was set, a spread keeps the other settings, omitting `allowedOrigins` disables CORS.

## How to get to it (user POV)

- `cors` in `antelope.config.ts`, or `SetCorsConfig({ ... })` from a module.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" cors
```

## Gotchas

- An origin counts as allowed when `Access-Control-Allow-Origin` equals it; the journeys never assert the literal sent otherwise.
- A `RegExp` cannot be written in a JSON module config, so the `RegExp` cases go through `SetCorsConfig`.
- Outside development the module sends no CORS header without a `cors` config: that check is in [servers](servers.md).
