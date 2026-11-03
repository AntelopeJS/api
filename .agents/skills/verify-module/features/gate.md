---
covers:
  - src/startup-gate.ts
docs:
  - README.md
journeys:
  - startup-gate
  - failed-start
  - module-lifecycle
---

# Gate

The startup gate of README.md: the port is served from `construct` on, but every request is answered `503 error.server_starting` with `Retry-After: 1` until `Events.ModulesStarted`, and again from `Events.ModulesStopping`; `GET /_live` always answers 200 and a CORS preflight is answered.

## Sub-features

- `startup-gate`: a consumer module whose `start` takes 4.5 s: GET, POST and an unknown path are 503 with the body and the header, nothing runs for them, `/_live` is 200 while `/_liveness`, `/_live/x` and `/_live2` are held back with 503, a preflight and a cross-origin 503 carry the CORS headers, a WebSocket is not upgraded; afterwards the route is served and a module's own `/_live` route does not shadow the probe; during a 4.5 s stop the gate answers 503 again while `/_live` stays 200; the consumer's `construct` connects to `${@api.API_PORT}`, so the socket is bound before other modules construct.
- `failed-start`: a consumer whose `start` throws after 2 s: `/ping` is polled until the project ends, a 503 is seen and a 200 never is.
- `module-lifecycle`: a second module registers a route; `StopModule` leaves the gate open (the core release after 1.17.0, as README.md documents), `StartModule` changes nothing, `DestroyModule` releases the module's route (unlisted and 404) and keeps the consumer's.

## How to get to it (user POV)

- A load balancer or browser calling the project while it boots or shuts down.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" gate
```

## Gotchas

- Not reached: a `start()` that has not settled after 120 s. The timer is core's, and api's side of it (the gate stays closed because `ModulesStarted` never comes) is what `failed-start` drives.
- With core 1.17.0 a failed start ends `ajs project dev` (exit 1) a moment after the failure. README.md says the project keeps answering 503 (draft `api-readme-failed-start-exits.md`), so `failed-start` pins only that nothing is served, never the exit.
- `module-lifecycle` pins the gate as the core release after 1.17.0 leaves it, which the repository tests with. Core 1.17.0 closes the gate then, which README.md documents too; the journey fails on it.
- The journey waits about 10 s for the delays it created.
