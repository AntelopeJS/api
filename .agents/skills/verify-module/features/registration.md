---
covers:
  - src/implementations/api/index.ts
docs:
  - README.md
journeys:
  - route-registration
  - custom-decorators
  - legacy-proto
  - module-lifecycle
---

# Registration

Programmatic registration of [Controllers and routes](https://interfaces.antelopejs.com/docs/api/controllers#programmatic-route-registration): `RegisterRoute`, `UnregisterRoute`, the two introspection functions, `ProcessCallback` and the priority levels.

## Sub-features

- `route-registration`: four registrations (a handler, a handler with a computed parameter, a prefix with a priority, the handler it guards) are served, listed by both introspection functions with the controller and the deprecated `proto`, every call returns a fresh array of shared handlers, `UnregisterRoute` removes one route and leaves its neighbours, down to nothing; two prefixes and a handler at one location, one prefix unregistered and the other still running; a `module` field in the handler is ignored for the registering module.
- `legacy-proto`: a handler that names only its `proto` (the interface-api 0.2 way) takes its controller from `proto.constructor`: a class built by `Controller`, a plain class and an empty object are served, injected properties are filled, `UnregisterRoute` removes it, and a proto with no constructor, a numeric constructor or a constructor without a prototype is refused with a `TypeError` and registers nothing.
- `custom-decorators`: `ProcessCallback` registers under the controller's location, uses the key when the location is omitted, takes a priority and returns `{ id }`; `HandlerPriority` is 0 to 4; `@Route` prefixes with HIGH, no priority and LOW run in that order.
- `module-lifecycle` (also in [gate](gate.md)): `DestroyModule` on a second module removes the route it owns and keeps the consumer's.

## How to get to it (user POV)

- A module that mounts routes at run time with `RegisterRoute({ mode, method, location, callback, parameters, properties, controller })`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" registration
```

## Gotchas

- `route-registration` registers with the documented `controller` field; `legacy-proto` registers with only `proto`, which the interface-api tarball on campaign/integration (interface-api#61, 0.3.0) now accepts. The `TypeError` message is not pinned.
