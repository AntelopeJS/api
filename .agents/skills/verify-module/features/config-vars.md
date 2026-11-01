---
covers:
  - src/config-vars.ts
docs:
  - README.md
journeys:
  - config-variables
  - manifest
---

# Config vars

The three config variables and the manifest of README.md: `configVars` in `dist/config-vars.js`, which tools call without starting the project, and the `antelopeJs` block of `package.json`.

## Sub-features

- `config-variables`: sixteen configurations: wildcard hosts become loopback, an absent host and port, an explicit host, IPv6 bare and bracketed, https, `publicBaseUrl` with trailing slashes, surrounding spaces, blank and empty, only the first server counts, no server and an empty `servers` throw.
- `manifest`: `implements`, `configVars`, `configVarsFile`, `defaultConfig` (one HTTP server on localhost:8080, as README.md says), `main` and `files`, and that the files they name are built.

## How to get to it (user POV)

- `${@api.API_PORT}`, `${@api.API_LOCAL_BASE_URL}`, `${@api.API_PUBLIC_BASE_URL}` in another module's config, and `ajs dms build`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" config-vars
```

## Gotchas

- `API_PORT` is the configured port here and the bound port when the project runs: [servers](servers.md) covers the second.
