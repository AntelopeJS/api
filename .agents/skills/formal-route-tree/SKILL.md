---
name: formal-route-tree
description: Generated-input check that the route table of @antelopejs/api registers, matches and unregisters like a Map-based reference router for any set of routes whose segments, parameter names and methods come from arbitrary strings, Object.prototype keys included (constructor, __proto__, toString, valueOf, hasOwnProperty), in the five handler modes. Use when a change touches src/route-table.ts, src/route-level.ts or src/route-search.ts, adds a lookup table, a parameter store or an index to the route tree, or needs proof that no path segment, method or parameter name can break registration or matching.
---

# Formal check: the route tree against a reference router

The module keeps routes in a tree of `RouteLevel`s, one tree per handler mode and method. A segment, a method or a parameter name is a string a developer or a content editor picks, such as a dms category slug `/constructor`. A lookup table that inherits from `Object.prototype` answers those names with an inherited function: registration threw `TypeError` and a request to `/valueOf/x` never got an answer (#135, #104).

**The property.** For any generated set of up to 10 routes, in any of the five modes (`handler`, `websocket`, `prefix`, `postfix`, `monitor`), whose segments are literals, `:name` parameters and a trailing `::name` catch-all, with literals, names and methods drawn from `Object.prototype` keys and from arbitrary Unicode strings, then for every probe request, before and after any subset of the routes is unregistered and after all are, the route table answers what `ReferenceRouter` in `src/test/route-reference.ts` answers: the same handler with the same parameters for `handler` and `websocket`, the same list in the same order for `prefix`, `postfix` and `monitor`, and `hasHandlers` agrees at every step. The reference keeps each table in a `Map`, so no name can collide with a prototype key; it states the documented rules: a method is lower-cased and `*`, empty or absent means `any`, a literal beats a parameter and a parameter beats a catch-all, and the first handler registered at a location answers.

**The harm.** A route that cannot be registered fails the module that declares it, and a path that throws inside the listener leaves the client waiting for an answer that never comes.

## Run it

From the repository root, with port 5010 free:

```sh
node .agents/skills/formal-route-tree/check.mjs          # 200 scenarios
node .agents/skills/formal-route-tree/check.mjs --full   # 2000 scenarios
```

`--runs <n>` and `--seed <n>` override the bounds and the seed. The check builds the module, then runs `src/test/formal-route-tree.test.ts` with `ajs module test`. It prints nothing when the property holds. It exits 1 and prints `BROKEN RouteTreeMatchesReference`, the seed, the smallest scenario fast-check shrank to and what each side answered; it exits 2 when it could not run. `pnpm test` runs the same file, so `pnpm run checks` covers it.

| Bounds | Scenarios | Wall time |
| --- | --- | --- |
| `pnpm test` and the default | 200 | 0.1 s |
| `--full` | 2000 | 1 s |

The seed is fixed (`20261117`), so a run repeats. Another seed explores other scenarios: `--seed 7 --full`.

Each scenario runs on a private copy of `src/route-table.ts` that the test loads again, because the module under test registers its own CORS and startup-gate handlers in the shared table. fast-check is version 3: version 4 does not typecheck under this repository's `tsconfig` (`pure-rand`'s types need `nodenext`).

## What the check holds to

| Step | Holds when |
| --- | --- |
| `registerHandler` of every route | It does not throw |
| A `handler` or `websocket` lookup, with the request path as `/a/b` or `/a/b/` | The handler and the parameters are the reference's, or both find nothing |
| A `prefix`, `postfix` or `monitor` lookup under one or two methods | The list of handlers and their parameters is the reference's, in order |
| `unregisterHandler` of a subset, then of every route | The lookups still agree and `hasHandlers` is false for a mode with no handler left |

## Findings

One at the sync commit, outside the property because the order is not documented: an unregistered route leaves its node in the tree, so two sibling dynamic segments (`:a` and `:b`) or two catch-alls (`::a` and `::b`) that match the same path are tried in the order their nodes were first created, not in the order of the routes registered now. In a fresh process:

```js
route("first-b", "/files/::b");
unregisterHandler("first-b");
route("a", "/files/::a");
route("b", "/files/::b");
findRouteHandler("handler", "get", ["files", "x"], "/files/x"); // answers b; a fresh tree answers a
```

A module that unregisters and registers routes again, as `ajs project run -w` does on reload, can change which of two overlapping parameter routes answers. The check runs each scenario on a fresh table, so it holds on registration order and never meets this.

## Scope and assumptions

| Covers | What it holds to |
| --- | --- |
| `src/route-table.ts` | registration, the exact-path index, lookups and removal |
| `src/route-level.ts`, `src/route-search.ts` | the tree and its walk, parameter capture and restore on backtracking |

Sync commit: `bd8056e`. Move it forward only after you confirm the check still describes the covered code at the new commit.

- A segment is a whole `:name` or a whole `::name`; a patterned segment such as `item-:id.json` and a catch-all with a suffix are not generated.
- A literal holds no `/`, `:` or line terminator, because `.` of a dynamic segment does not match a line terminator and no URL path holds one.
- A route is registered once under its id, with the default priority; priority order is not generated.
- The check calls the route table, not the HTTP listener: how `server.ts` splits the URL, lower-cases the method and falls back from `HEAD` to `GET` is for the verify-module journeys.

## Confirm the check can fail

| Scratch change | Result |
| --- | --- |
| `git show 6c58d92^:src/route-table.ts` (and `route-level.ts`, `route-search.ts`) copied over the three files, the code before #135 | Fails on the first scenario: a `handler` route `/constructor` throws `Cannot read properties of undefined (reading 'push')` |
| In `restoreParameter` of `src/route-search.ts`, assign `previousValue` where it deletes the parameter | A `postfix` lookup collects a handler with `toLocaleString: null` that the reference does not give |

Drop each change with `git checkout src` and confirm the check is back to exit 0.
