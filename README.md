# @antelopejs/api

<div align="center">
<a href="https://www.npmjs.com/package/@antelopejs/api"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/api?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/api?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://interfaces.antelopejs.com/docs/api/introduction"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

The HTTP and WebSocket server of AntelopeJS, built on the Node.js `http`, `https` and `ws` servers.

## Interfaces

| Interface                                                                            | Documentation                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [`@antelopejs/interface-api`](https://github.com/AntelopeJS/interface-api)           | [API](https://interfaces.antelopejs.com/docs/api/introduction)           |
| [`@antelopejs/interface-api-util`](https://github.com/AntelopeJS/interface-api-util) | [API Util](https://interfaces.antelopejs.com/docs/api-util/introduction) |

Controllers, routes, parameter injection, prefix and postfix handlers and WebSocket handlers are documented on the interface pages.

## Install

```bash
ajs project modules add @antelopejs/api
```

The command writes the module's default configuration: one HTTP server on `localhost:8080`. In a project whose modules import `@antelopejs/interface-api`, `ajs project modules install` also adds this module when nothing implements the interface yet.

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

| Key             | Default                      | Description                                                                                                                                                     |
| --------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `servers`       | one HTTP server on port `80` | Servers to start. Each entry takes `protocol` (`http` or `https`), optional `host` and `port`, and any Node.js `http.ServerOptions` or `https.ServerOptions`.   |
| `publicBaseUrl` | `API_LOCAL_BASE_URL` in dev  | Origin browsers use to reach the API. Required outside development: the boot fails without it.                                                                  |
| `strictPort`    | `false`                      | Fail instead of falling back to the next free port in development. Outside development, the module always binds the exact port.                                 |
| `autoListen`    | `true`                       | Set to `false` to create the servers without serving them until a module calls `Listen()`.                                                                      |
| `cors`          | none                         | CORS policy. `allowedMethods` defaults to `GET,HEAD,PUT,PATCH,POST,DELETE`, and `credentials` defaults to `true`. Change it at run time with `SetCorsConfig()`. |

In development, loopback origins (`localhost`, `127.0.0.1`, `[::1]`, any port) pass CORS without configuration. Every other origin must be listed in `allowedOrigins`.

### Config variables

The module publishes three [config variables](https://framework.antelopejs.com/docs/concepts/configuration#module-config-variables), all derived from the first entry of `servers`. Other modules read them with `${@api.<NAME>}`, where `api` is the module's key in `modules`:

| Variable              | Value                                                      |
| --------------------- | ---------------------------------------------------------- |
| `API_PORT`            | The port the first server actually bound.                  |
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

The package also declares the function computing them from the configuration, `configVars` in `dist/config-vars.js`, as `antelopeJs.configVarsFile`. A tool that reads the project without running it, such as `ajs dms build`, resolves `${@api.<NAME>}` from that function: `API_PORT` is then the configured port, and `API_PUBLIC_BASE_URL` falls back to `API_LOCAL_BASE_URL` when `publicBaseUrl` is not set.

### Startup gate

The port is served from `construct` on, but every request is answered `503` with the body `error.server_starting` and `Retry-After: 1` until the core announces that every module has started (`Events.ModulesStarted` of `@antelopejs/interface-core/modules`, emitted by `@antelopejs/core`). It answers `503` again from the moment the whole project starts stopping (`Events.ModulesStopping`), at shutdown. Stopping, reloading or removing a single module at runtime leaves the gate open; the core release that introduced the gate still closes it then, the next core release does not ([AntelopeJS/antelopejs#219](https://github.com/AntelopeJS/antelopejs/pull/219)). A module that fails to start at launch leaves the project answering `503`, and so does a `start()` that has not settled after 120 s, which fails the start. Nothing runs for a held request, so clients can retry it. CORS preflights are answered while the gate is closed, so a browser can read the `503`.

`GET /_live` always answers `200`: use it as the liveness probe, and a normal route as the readiness probe.

## Quick start

In the module that serves the routes, add the interface:

```bash
pnpm add @antelopejs/interface-api
```

Declare a controller. The module loads it on import:

```typescript [src/index.ts]
import { Controller, Get, Parameter } from "@antelopejs/interface-api";

export class HelloController extends Controller("/hello") {
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

Run the project with `ajs project dev`, then call `GET http://localhost:8080/hello?name=Ada`.

## Documentation

- [API](https://interfaces.antelopejs.com/docs/api/introduction): the `@antelopejs/interface-api` contract this module implements
- [API Util](https://interfaces.antelopejs.com/docs/api-util/introduction): the `@antelopejs/interface-api-util` contract this module implements
- [Configuration](https://framework.antelopejs.com/docs/concepts/configuration): module sources, `config` blocks and config variables in `antelope.config.ts`

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                          | Supported                                                      | Tested with                                                    |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `@antelopejs/core`               | `>=1.17.0 <2`                                                  | `1.17.0`                                                       |
| `@antelopejs/interface-api`      | `file:.campaign/tgz/antelopejs-interface-api-70e7935.tgz`      | `file:.campaign/tgz/antelopejs-interface-api-70e7935.tgz`      |
| `@antelopejs/interface-api-util` | `file:.campaign/tgz/antelopejs-interface-api-util-385c5f2.tgz` | `file:.campaign/tgz/antelopejs-interface-api-util-385c5f2.tgz` |
| `@antelopejs/interface-core`     | `>=0.2.6 <1.0.0`                                               | `0.2.6`                                                        |

<!-- antelopejs-docs-compat:end -->

Since 1.6.0 the module loads the 0.1 line of `interface-api` and the 0.2 line of `interface-api-util`. `@antelopejs/core` refuses to start a project in which another loaded module declares a range that excludes the shared copy, and reports `Incompatible interface package resolution`, naming the module, its range and the shared copy. Widen such ranges to admit those two lines before upgrading, or stay on the 1.5 release line of this module, which still loads the 0.1 line of `interface-api-util`.

The module is developed and tested on Node.js 24.

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
