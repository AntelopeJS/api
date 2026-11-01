---
covers:
  - src/implementations/api/index.ts
  - src/thenable.ts
docs:
  - README.md
journeys:
  - parameter-sources
  - multi-parameters
  - property-parameters
  - parameter-modifiers
  - parameter-transform
  - parameter-providers
---

# Parameters

The parameter decorators of [Read and transform request data](https://interfaces.antelopejs.com/docs/api/parameters): sources, repeated and empty values, the processing chain of a provider and its modifiers, `@Transform` and custom providers.

## Sub-features

- `parameter-sources`: route segment (default and explicit), query, header in any case, `?page` and `?page=` are `true`, a repeated query value is its first, a missing value is `undefined`, an escaped value is decoded, everything mixed in one handler.
- `multi-parameters`: `@MultiParameter` returns every query value, keeps empty strings, is `[]` when nothing is sent, ignores other names, reads a header, and does not split a comma-separated or repeated header (Node.js joins it).
- `property-parameters`: decorators on class properties (`@Parameter`, `@MultiParameter`, `@JSONBody`, `@RawBody`, `@Context`) fill the instance for each request and never keep the previous request's values.
- `parameter-modifiers`: the docs' `EnsureNumber`, stacked modifiers apply bottom to top, an asynchronous modifier is awaited, a throwing modifier stops the chain before the handler (a 500 with its message).
- `parameter-transform`: the docs' `parseId` with `@Transform`: a positive id, the largest safe integer, `12abc`, `0`, `-1`, `007`, `1e3` and `1.5` are 400, an unsafe integer is 400 with its own message.
- `parameter-providers`: the docs' typed `BearerToken` (`ParameterProvider<string | undefined>` and `ParameterModifier<string | undefined>`) provider plus modifier, a provider that reads the request context, custom and built-in decorators together, two arguments that read the body share one read.

## How to get to it (user POV)

- `@Parameter(name, source?)`, `@MultiParameter(name, source?)`, `@Transform(fn)`, and decorators built with `MakeParameterDecorator`, `SetParameterProvider` and `AddParameterModifier`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" parameters
```

## Gotchas

- The journeys compile the docs' own examples with the repository's `tsc`: a declaration the docs rely on that the installed interface no longer has fails the compile step.
- A query value is the first of the repeated values and `true` when the name has no value: assert the JSON type, not its text.
