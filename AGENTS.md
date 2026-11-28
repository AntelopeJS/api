# api

The HTTP and WebSocket server module of AntelopeJS, published as `@antelopejs/api`. It implements `@antelopejs/interface-api` and `@antelopejs/interface-api-util` (`antelopeJs.implements` in `package.json`) on the Node.js `http`, `https` and `ws` servers.

## Layout

- `src/index.ts` is the module entry (`provide`, `construct`, `start`, `stop`, `destroy`); `src/implementations/api` binds the interface-api proxies, and `src/middlewares/cors.ts` holds CORS.
- `src/config-vars.ts` compiles to `dist/config-vars.js`, which `antelopeJs.configVarsFile` names. Tools load it by path without starting the project to resolve `${@api.API_PORT}`, `${@api.API_LOCAL_BASE_URL}` and `${@api.API_PUBLIC_BASE_URL}`, so keep it a pure function of the module config. Renaming a config var, or the `configVarsFile` entry, is a breaking change.
- `playground/` is a pnpm workspace package: a project that loads this module from `..`. It is not part of the published package.

## Versioning

- Every `@antelopejs/*` range stops below the next minor of its floor (`>=0.5.1 <0.6.0` on 0.x, `~1.23.0` from 1.0), with its floor in the newest published minor; the `dependency:ranges` step of `pnpm run checks` enforces the cap.
- A change users must act on, such as a raised core or interface minimum, gets an `### Upgrade notes` section in `CHANGELOG.md`, added after the release in a `docs(changelog)` commit (see #71 and #74).

## Tests

- The suites live in `src/test` and compile with the package. `pnpm test` builds `dist` once, then `ajs module test .` (from the `@antelopejs/core` devDependency) loads `src/test/antelope.test.ts`, the `antelopeJs.test` config, which runs `dist/test` against a server on `127.0.0.1:5010`. That port must be free. `pnpm run checks` runs them.
- `pnpm run checks` does not run the playground. Run it with `pnpm dev` (`ajs project run -w -p playground`); it also serves on port 5010.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, check only what you touched, one test file and not the suite, as the [`verify-changes`](.agents/skills/verify-changes/SKILL.md) skill says.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
