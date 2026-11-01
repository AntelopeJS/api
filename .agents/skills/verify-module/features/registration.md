---
covers:
  - src/implementations/api/index.ts
docs:
  - README.md
journeys:
  - route-registration
  - custom-decorators
  - controller-required
  - module-lifecycle
---

# Registration

Programmatic registration of [Controllers and routes](https://interfaces.antelopejs.com/docs/api/controllers#programmatic-route-registration): `RegisterRoute`, `UnregisterRoute`, the two introspection functions, `ProcessCallback` and the priority levels.

## Sub-features

- `route-registration`: four registrations (a handler, a handler with a computed parameter, a prefix with a priority, the handler it guards) are served, listed by both introspection functions with the controller they were registered under, every call returns a fresh array of shared handlers, `UnregisterRoute` removes one route and leaves its neighbours, down to nothing; two prefixes and a handler at one location, one prefix unregistered and the other still running; a `module` field in the handler is ignored for the registering module.
- `controller-required`: a handler with no `controller`, or with only the removed `proto` field (a class built by `Controller`, a plain class, an empty object), is refused with a `TypeError` and registers nothing; the same handler with its `controller` is registered, listed under that class and served. The `TypeError` message is not pinned.
- `custom-decorators`: `ProcessCallback` registers under the controller's location, uses the key when the location is omitted, takes a priority and returns `{ id }`; `HandlerPriority` is 0 to 4; `@Route` prefixes with HIGH, no priority and LOW run in that order.
- `module-lifecycle` (also in [gate](gate.md)): `DestroyModule` on a second module removes the route it owns and keeps the consumer's.

## How to get to it (user POV)

- A module that mounts routes at run time with `RegisterRoute({ mode, method, location, callback, parameters, properties, controller })`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" registration
```

## Gotchas

- `route-registration` registers with the documented `controller` field; `controller-required` registers without it. interface-api has no `proto` field and api has no fallback for it (api#100).
