---
covers:
  - src/startup-gate.ts
docs:
  - README.md
journeys:
  - startup-gate
---

# Gate

The startup gate of README.md: the port is served from `construct` on, but every request is answered `503 error.server_starting` with `Retry-After: 1` until `Events.ModulesStarted`, and again from `Events.ModulesStopping`; `GET /_live` always answers 200 and a CORS preflight is answered.

## Sub-features

- `startup-gate`: a consumer module whose `start` takes 4.5 s: GET, POST and an unknown path are 503 with the body and the header, nothing runs for them, `/_live` is 200, a preflight and a cross-origin 503 carry the CORS headers, a WebSocket is not upgraded; afterwards the route is served and a module's own `/_live` route does not shadow the probe; during a 4.5 s stop the gate answers 503 again.

## How to get to it (user POV)

- A load balancer or browser calling the project while it boots or shuts down.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" gate
```

## Gotchas

- Not reached: a `start()` that has not settled after 120 s, and stopping, reloading or removing a single module at runtime (needs a reload the harness does not drive).
- The journey waits about 10 s for the delays it created.
