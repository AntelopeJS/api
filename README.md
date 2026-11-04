# `@antelopejs/api`

<div align="center">
<a href="https://www.npmjs.com/package/@antelopejs/api"><img data-illustration alt="npm" src="https://img.shields.io/npm/v/@antelopejs/api?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img data-illustration alt="License" src="https://img.shields.io/npm/l/@antelopejs/api?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/g4pFt6eXqu"><img data-illustration src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://interfaces.antelopejs.com/docs/api/introduction"><img data-illustration src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

The HTTP and WebSocket server module of AntelopeJS. It implements the API interfaces on the Node.js `http`, `https`, and `ws` servers, so the controllers and routes that other modules declare with `@antelopejs/interface-api` answer requests.

## Interfaces

| Interface                                                                            | Documentation                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [`@antelopejs/interface-api`](https://github.com/AntelopeJS/interface-api)           | [API](https://interfaces.antelopejs.com/docs/api/introduction)           |
| [`@antelopejs/interface-api-util`](https://github.com/AntelopeJS/interface-api-util) | [API Util](https://interfaces.antelopejs.com/docs/api-util/introduction) |

The interface pages document controllers, routes, parameter injection, prefix and postfix handlers, and WebSocket handlers.

## Install

```bash
ajs project modules add @antelopejs/api
```

The command writes the module's default configuration, which is one HTTP server on `localhost:8080`. In a project whose modules import `@antelopejs/interface-api`, `ajs project modules install` also adds this module when nothing implements the interface yet.

## Configuration

```typescript [antelope.config.ts]
import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "my-project",
  modules: {
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.3.4",
      },
      config: {
        servers: [
          { protocol: "http", host: "localhost", port: 8080 },
          { protocol: "https", port: 8443, cert: "<pem>", key: "<pem>" },
        ],
        publicBaseUrl: "https://api.example.com",
        strictPort: false,
        autoListen: true,
        cors: {
          allowedOrigins: ["https://app.example.com", /\.example\.com$/],
          allowedMethods: ["GET", "POST", "PUT", "DELETE"],
          allowedHeaders: ["content-type", "authorization"],
          credentials: true,
          maxAge: 600,
        },
      },
    },
  },
});
```

| Key             | Default                      | Description                                                                                                                                                      |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `servers`       | one HTTP server on port `80` | Servers to start. Each entry takes `protocol` (`http` or `https`), an optional `host` and `port`, and any Node.js `http.ServerOptions` or `https.ServerOptions`. |
| `publicBaseUrl` | `API_LOCAL_BASE_URL` in dev  | Origin that browsers use to reach the API. Outside development it is required, and the boot fails without it.                                                    |
| `strictPort`    | `false`                      | In development, fail instead of falling back to the next free port. Outside development, the module always binds the exact port.                                 |
| `autoListen`    | `true`                       | Set to `false` to create the servers and serve them only when a module calls `Listen()`.                                                                         |
| `cors`          | none                         | CORS policy. `allowedMethods` defaults to `GET,HEAD,PUT,PATCH,POST,DELETE`, and `credentials` defaults to `true`. Change it at run time with `SetCorsConfig()`.  |

In development, loopback origins (`localhost`, `127.0.0.1`, `[::1]`, any port) pass CORS without configuration. List every other origin in `allowedOrigins`.

### Config variables

The module publishes three [config variables](https://framework.antelopejs.com/docs/concepts/configuration#module-config-variables). Each one comes from the first entry of `servers`. Other modules read them with `${@api.<NAME>}`, where `api` is the module's key in `modules`.

| Variable              | Value                                                      |
| --------------------- | ---------------------------------------------------------- |
| `API_PORT`            | The port that the first server bound.                      |
| `API_LOCAL_BASE_URL`  | The same-host origin, for example `http://127.0.0.1:8080`. |
| `API_PUBLIC_BASE_URL` | `publicBaseUrl`, without trailing slashes.                 |

```typescript fragment [antelope.config.ts]
modules: {
  "file-storage-local": {
    config: { baseUrl: "${@api.API_PUBLIC_BASE_URL}" },
  },
},
```

The module binds its listening sockets before any other module constructs, so `API_PORT` is always the port the server serves.

The package names the function that computes them, `configVars` in `dist/config-vars.js`, in `antelopeJs.configVarsFile`. A tool that reads the project without running it, such as `ajs dms build`, resolves `${@api.<NAME>}` with that function. In that case `API_PORT` is the configured port, and `API_PUBLIC_BASE_URL` falls back to `API_LOCAL_BASE_URL` when `publicBaseUrl` is not set.

### Startup gate

The module serves the port from `construct` on. Until the core announces that every module has started, it answers every request with `503`, the body `error.server_starting`, and `Retry-After: 1`. `@antelopejs/core` sends that announcement as `Events.ModulesStarted` of `@antelopejs/interface-core/modules`. When the whole project starts to stop at shutdown (`Events.ModulesStopping`), the module answers `503` again. Stopping, reloading, or removing a single module at run time leaves the gate open.

A module that fails to start at launch leaves the project answering `503`. So does a `start()` that has not settled after 120 seconds, which makes the start fail. Nothing runs for a request the gate holds, so a client can retry it. The module answers CORS preflights while the gate is closed, so a browser can read the `503`.

`GET /_live` always answers `200`. Use it as the liveness probe, and use a normal route as the readiness probe.

## Quick start

In the module that serves the routes, add the interface.

```bash
pnpm add @antelopejs/interface-api
```

Declare a controller in the module entry. Its decorators register the routes when the module loads.

```typescript [src/index.ts]
import { Controller, Get, Parameter } from "@antelopejs/interface-api";

export class HelloController extends Controller("/greetings") {
  @Get()
  hello(@Parameter("name", "query") name = "world") {
    return { message: `Hello ${name}` };
  }
}

export function construct(): void {}
export function destroy(): void {}
export function start(): void {}
export function stop(): void {}
```

`@Get()` without a location uses the method name, so the route is `/greetings/hello`. Run the project with `ajs project dev`, then call `GET http://localhost:8080/greetings/hello?name=Ada`.

## Documentation

- [API](https://interfaces.antelopejs.com/docs/api/introduction) documents the `@antelopejs/interface-api` contract that this module implements.
- [API Util](https://interfaces.antelopejs.com/docs/api-util/introduction) documents the `@antelopejs/interface-api-util` contract that this module implements.
- [Configuration](https://framework.antelopejs.com/docs/concepts/configuration) documents module sources, `config` blocks, and config variables in `antelope.config.ts`.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                          | Supported                                                      | Tested with                                                    |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `@antelopejs/core`               | `>=1.17.0 <2`                                                  | `file:.campaign/tgz/antelopejs-core-184eb90.tgz`               |
| `@antelopejs/interface-api`      | `>=0.2.0 <0.4.0`                                               | `0.2.0`                                                        |
| `@antelopejs/interface-api-util` | `file:.campaign/tgz/antelopejs-interface-api-util-639f38b.tgz` | `file:.campaign/tgz/antelopejs-interface-api-util-639f38b.tgz` |
| `@antelopejs/interface-core`     | `>=0.4.0 <1.0.0`                                               | `0.4.0`                                                        |

<!-- antelopejs-docs-compat:end -->

The generated table lists `@antelopejs/core`, which this module requires as a peer dependency, and the interface packages it loads, with their ranges read from `package.json`. If another loaded module declares a range that excludes the copy this module loads, `@antelopejs/core` refuses to start the project. It reports `Incompatible interface package resolution` and names the module, its range, and the copy it found.

## Contributing

```bash
pnpm install
pnpm dev            # run the playground/ project in watch mode
pnpm lint
pnpm format:check
pnpm knip
pnpm test           # build, then ajs module test
```

Read the [contribution guidelines](CONTRIBUTING.md) before opening a pull request.

## License

[Apache-2.0](LICENSE)
