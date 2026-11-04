---
covers:
docs:
  - README.md
journeys:
  - module-dev
  - route-forms
---

# Smoke

The fixed journey every verdict runs, whatever the diff touches: load the module as `local` on a free loopback port, let the pack's `module-dev` check that the consumer sees both implemented interfaces and Ctrl+C exits 130, then call a controller's routes over HTTP.

## Sub-features

- `module-dev`: the pack's journey.
- `route-forms`: as in [routes](routes.md).

## How to get to it (user POV)

- A project with `@antelopejs/api` in `antelope.config.ts` and a module that declares a controller with `@antelopejs/interface-api`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" smoke
```

## Gotchas

- The smoke feature covers no glob, so it never marks a file as mapped.
- The module config of the pack's journey asks for port 0 so two runs never share a port.
