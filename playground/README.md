# Playground

A local AntelopeJS project for trying `@antelopejs/api` while you change it. `antelope.config.ts` loads two modules from this repository: `api` from the parent folder, with one HTTP server on port `5010`, and `playground` from this folder.

## Run it

From the repository root, run the project in watch mode:

```bash
pnpm dev
```

`pnpm dev` runs `ajs project run -w -p playground`. Port `5010` must be free, because the test suites use it too.

## Routes

`PlaygroundController` in `src/index.ts` serves these routes under `/playground`:

| Route                       | Answer                                                                         |
| --------------------------- | ------------------------------------------------------------------------------ |
| `GET /playground/hello`     | `{ "message": "Hello World" }`                                                 |
| `POST /playground/echo`     | The JSON body under `received`.                                                |
| `PUT /playground/update`    | The JSON body under `updated`.                                                 |
| `DELETE /playground/remove` | `{ "message": "Deleted" }`                                                     |
| `GET /playground/ping`      | `{ "message": "Pong", "pong": "pong" }` for `?pong=pong`, and `400` otherwise. |

The `playground` module receives the three config variables of `api` (`API_PORT`, `API_LOCAL_BASE_URL`, and `API_PUBLIC_BASE_URL`) as `apiPort`, `apiLocalBaseUrl`, and `apiPublicBaseUrl`, and logs them from `construct`.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                          | Supported        | Tested with |
| -------------------------------- | ---------------- | ----------- |
| `@antelopejs/interface-api`      | `>=0.2.0 <1.0.0` | `0.2.0`     |
| `@antelopejs/interface-api-util` | `>=0.3.0 <1.0.0` | `0.3.0`     |
| `@antelopejs/interface-core`     | `>=0.4.0 <1.0.0` | `0.4.0`     |

<!-- antelopejs-docs-compat:end -->
