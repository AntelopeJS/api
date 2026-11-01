---
covers:
  - src/implementations/api/index.ts
docs:
  - README.md
journeys:
  - controller-instances
---

# Instances

`GetControllerInstance` and the per-request controller instance of [Controllers and routes](https://interfaces.antelopejs.com/docs/api/controllers#controller-instances): a new instance for each request, injected properties filled, one instance per class within a request.

## Sub-features

- `controller-instances`: two requests get two instances, another controller reads the instance of the current request with its header-injected property, a second call in the same request returns the same instance, classes built by `extend` and `PartialController` give instances.

## How to get to it (user POV)

- `await GetControllerInstance(OtherController, context)` inside a handler.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" instances
```

## Gotchas

- The constructor of the controller pushes to a list the journey reads back, so the number of instances is observed rather than assumed.
