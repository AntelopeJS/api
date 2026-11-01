---
covers:
  - src/route-table.ts
  - src/route-search.ts
  - src/route-level.ts
docs:
  - README.md
journeys:
  - route-forms
  - controller-tree
  - quick-start
---

# Routes

How controllers and route decorators turn into served routes, as [Controllers and routes](https://interfaces.antelopejs.com/docs/api/controllers) documents them: the location forms, the verbs, `@Route` for other methods, `extend`, `PartialController` and `Controller(location, Base)`.

## Sub-features

- `route-forms`: an omitted location is the method name, `""` is the controller root, `:id` and two named segments capture, a leading slash is relative, POST/PUT/DELETE/PATCH reach their handlers, a second controller beside the first, a verb or path nobody registered is 404 (a GET to a POST-only path, a POST to a GET-only one), an escaped space still reaches `:id`.
- `controller-tree`: `extend` at two depths gives the full location and the parent's static members, `PartialController` adds a route at the same location, the partial controller's handler reads a header property declared on the controller it extends, instances of `Controller(location, Base)` carry the base class's methods.
- `quick-start`: the README.md quick start controller, verbatim: `Hello world` without a name, `Hello Ada` with `?name=Ada`.

## How to get to it (user POV)

- `class X extends Controller("/x")` with `@Get`, `@Post`, `@Put`, `@Delete` and `@Route("handler", method, location)` methods, imported by a module.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" routes
```

## Gotchas

- `@Get()` registers the method name, not the controller root: the controller root needs `@Get("")`, as the docs say.
- The README.md quick start says to call `GET /hello?name=Ada`, but its `@Get()` registers `/hello/hello` (the method name, as the interface docs say), and `/hello` is 404. `quick-start` requests `/hello/hello` and does not request `/hello`, so the README bug is not pinned (draft `api-readme-quick-start-path.md`).
- The 404 for an unregistered verb or path is the module's behaviour; the docs do not name the body.
