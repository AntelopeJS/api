# Feature map

One file per feature. `covers:` lists the source globs it owns, `docs:` the pages a verdict judges, and `journeys:` the journeys it runs. `pnpm exec antelopejs-verify map` checks that every user-facing file is covered.

The module keeps no state and calls no service, so `verify.config.ts` declares no `services` and no journey needs a container. Journeys drive the module over HTTP and WebSocket on free loopback ports.

| Feature | What the user does | Journeys |
|---|---|---|
| [routes](routes.md) | Declares controllers and route decorators and gets served routes. | route-forms, controller-tree, quick-start |
| [handlers](handlers.md) | Combines prefix, main, postfix and monitor handlers on a route. | handler-modes, handler-priority, postfix-chain, method-scoping, star-method, falsy-returns, route-modes, async-handlers, middleware-matrix |
| [parameters](parameters.md) | Reads request data with parameter decorators, modifiers, `@Transform` and custom providers. | parameter-sources, multi-parameters, property-parameters, last-provider, parameter-modifiers, parameter-transform, parameter-providers |
| [bodies](bodies.md) | Reads raw, JSON and streamed request bodies within limits, and the request context. | body-reading, body-limits, body-streaming, request-context |
| [results](results.md) | Returns plain values, `HTTPResult`, headers, thrown results and streams. | result-bodies, result-headers, result-errors, response-streaming |
| [instances](instances.md) | Gets a fresh controller instance per request with `GetControllerInstance`. | controller-instances |
| [registration](registration.md) | Registers and unregisters routes from code and writes custom decorators. | route-registration, custom-decorators, controller-required, module-lifecycle |
| [websocket](websocket.md) | Serves WebSocket connections with `@WebsocketHandler` and `@Connection`. | websocket-handlers, secure-websocket |
| [guards](guards.md) | Guards routes with `assert`, `assertValidation` and `RateLimit` from interface-api-util. | assert-guards, assert-validations, rate-limiting, rate-limit-ordering |
| [cors](cors.md) | Sets the CORS policy in the module config or at run time with `SetCorsConfig`. | cors-config, cors-defaults, cors-runtime, cors-credentials, cors-unconfigured |
| [servers](servers.md) | Configures `servers`, `publicBaseUrl`, `strictPort` and `autoListen`. | server-ports, port-fallback, server-protocols, server-options, dev-registry, server-sockets, server-reload, listen-on-demand, production-boot |
| [gate](gate.md) | Gets `503` until every module has started, and `GET /_live` at any time. | startup-gate, failed-start, module-lifecycle |
| [config-vars](config-vars.md) | Resolves `${@api.*}` config variables and adds the module with its manifest. | config-variables, manifest, modules-add, interface-ranges |
| [smoke](smoke.md) | The fixed journey every verdict runs. | module-dev, route-forms |
