# api

The HTTP and WebSocket server module of AntelopeJS, published as `@antelopejs/api`. It implements `@antelopejs/interface-api` and `@antelopejs/interface-api-util` (`antelopeJs.implements` in `package.json`) on the Node.js `http`, `https` and `ws` servers.

## Layout

- `src/index.ts` is the module entry (`provide`, `construct`, `start`, `stop`, `destroy`); `src/implementations/api` binds the interface-api proxies, and `src/middlewares/cors.ts` holds CORS.
- `src/config-vars.ts` compiles to `dist/config-vars.js`, which `antelopeJs.configVarsFile` names. Tools load it by path without starting the project to resolve `${@api.API_PORT}`, `${@api.API_LOCAL_BASE_URL}` and `${@api.API_PUBLIC_BASE_URL}`, so keep it a pure function of the module config. Renaming a config var, or the `configVarsFile` entry, is a breaking change.
- `playground/` is a pnpm workspace package: a project that loads this module from `..`. It is not part of the published package.

## Versioning

- The startup gate relies on `Events.ModulesStarted`, which only `@antelopejs/core` 1.17.0 and later emit, so the `@antelopejs/core` peer range stays `>=1.17.0 <2`, and `@antelopejs/interface-core` stays at `>=0.2.6`.
- A change users must act on, such as a raised core or interface minimum, gets an `### Upgrade notes` section in `CHANGELOG.md`, added after the release in a `docs(changelog)` commit (see #71 and #74).

## Tests

- The suites live in `src/test` and compile with the package. `pnpm test` builds `dist` once, then `ajs module test .` (from the `@antelopejs/core` devDependency) loads `src/test/antelope.test.ts`, the `antelopeJs.test` config, which runs `dist/test` against a server on `127.0.0.1:5010`. That port must be free. `pnpm run checks` runs them.
- `pnpm run checks` does not run the playground. Run it with `pnpm dev` (`ajs project run -w -p playground`); it also serves on port 5010.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
