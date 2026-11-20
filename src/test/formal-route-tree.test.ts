import assert from "node:assert";
import { createRequire } from "node:module";
import fc from "fast-check";

import type {
  HandlerResult,
  RouteDefinition,
  findRouteHandler as FindRouteHandler,
} from "../route-table";
import type { RouteCallback } from "../request-context";
import {
  type Match,
  type Mode,
  ReferenceRouter,
  type Segment,
} from "./route-reference";

const ROUTE_TREE_FILES = /[\\/]route-(?:table|level|search)\.js$/;

type RouteTable = typeof import("../route-table");

/**
 * A private copy of the route table. The module under test registers its own
 * CORS and gate handlers in the shared one, which would answer a probe beside
 * the routes of a scenario.
 */
async function isolatedRouteTable(): Promise<RouteTable> {
  const { cache } = createRequire(__filename);
  const shared = Object.entries(cache).filter(([file]) =>
    ROUTE_TREE_FILES.test(file),
  );
  for (const [file] of shared) {
    delete cache[file];
  }
  const fresh = await import("../route-table");
  for (const file of Object.keys(cache)) {
    if (ROUTE_TREE_FILES.test(file)) {
      delete cache[file];
    }
  }
  for (const [file, module] of shared) {
    cache[file] = module;
  }
  return fresh;
}

let table: RouteTable;

const RUNS = Number(process.env.FORMAL_RUNS ?? 200);
const MS_PER_RUN = 150;
const MIN_TIMEOUT_MS = 30_000;
const SEED = Number(process.env.FORMAL_SEED ?? 20_261_117);
const MODES: readonly Mode[] = [
  "handler",
  "prefix",
  "postfix",
  "monitor",
  "websocket",
];
const PROTOTYPE_KEYS = [
  "constructor",
  "__proto__",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__defineGetter__",
  "__lookupGetter__",
];
const PARAMETER_NAMES = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "a",
  "b",
];
const METHODS = [
  "get",
  "post",
  "any",
  "constructor",
  "__proto__",
  "toString",
  "valueOf",
  "hasOwnProperty",
];

const FORBIDDEN = new Set([
  "/",
  ":",
  "\n",
  "\r",
  String.fromCharCode(0x2028),
  String.fromCharCode(0x2029),
]);

interface RouteSpec {
  readonly mode: Mode;
  readonly method: string | undefined;
  readonly segments: readonly Segment[];
}

interface ProbeSpec {
  readonly mode: Mode;
  readonly method: string;
  readonly methods: readonly string[];
  readonly path: readonly string[];
  readonly trailingSlash: boolean;
}

interface Scenario {
  readonly routes: readonly RouteSpec[];
  readonly probes: readonly ProbeSpec[];
  readonly removed: readonly number[];
}

/** Any text a URL path segment can hold: no `/`, no `:` (which makes a segment dynamic) and no line terminator (which `.` of a dynamic segment does not match). */
function isSegmentText(text: string): boolean {
  return (
    text !== "" && Array.from(FORBIDDEN).every((char) => !text.includes(char))
  );
}

function location(segments: readonly Segment[]): string {
  return segments
    .map((segment) =>
      segment.kind === "static"
        ? segment.text
        : segment.kind === "param"
          ? `:${segment.name}`
          : `::${segment.name}`,
    )
    .join("/");
}

function segmentsOf(words: readonly string[]): fc.Arbitrary<Segment[]> {
  const literal = fc
    .constantFrom(...words)
    .map((text): Segment => ({ kind: "static", text }));
  const parameter = fc
    .constantFrom(...PARAMETER_NAMES)
    .map((name): Segment => ({ kind: "param", name }));
  const rest = fc
    .constantFrom(...PARAMETER_NAMES)
    .map((name): Segment => ({ kind: "rest", name }));
  return fc
    .tuple(
      fc.array(fc.oneof({ weight: 3, arbitrary: literal }, parameter), {
        maxLength: 3,
      }),
      fc.option(rest, { nil: undefined }),
    )
    .map(([head, tail]) => (tail ? [...head, tail] : head));
}

function routeSpecOf(words: readonly string[]): fc.Arbitrary<RouteSpec> {
  const method = fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom(...METHODS) },
    fc.constantFrom("GET", "Constructor", "VALUEOF", "*", "", undefined),
    fc.string({ maxLength: 6 }),
  );
  return fc.record({
    mode: fc.constantFrom(...MODES),
    method,
    segments: segmentsOf(words),
  });
}

function probeSpecOf(words: readonly string[]): fc.Arbitrary<ProbeSpec> {
  const segment = fc.oneof(
    { weight: 8, arbitrary: fc.constantFrom(...words) },
    fc
      .string({ unit: "grapheme", minLength: 1, maxLength: 4 })
      .filter(isSegmentText),
  );
  return fc.record({
    mode: fc.constantFrom(...MODES),
    method: fc.constantFrom(...METHODS, "*"),
    methods: fc.array(fc.constantFrom(...METHODS), {
      minLength: 1,
      maxLength: 2,
    }),
    path: fc.array(segment, { maxLength: 4 }),
    trailingSlash: fc.boolean(),
  });
}

function scenarioArbitrary(): fc.Arbitrary<Scenario> {
  const word = fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...PROTOTYPE_KEYS, "a", "b") },
    fc
      .string({ unit: "grapheme", minLength: 1, maxLength: 4 })
      .filter(isSegmentText),
  );
  return fc.array(word, { minLength: 2, maxLength: 6 }).chain((words) =>
    fc
      .array(routeSpecOf(words), { minLength: 1, maxLength: 10 })
      .chain((routes) =>
        fc.record({
          routes: fc.constant(routes),
          probes: fc.array(probeSpecOf(words), { minLength: 1, maxLength: 12 }),
          removed: fc.shuffledSubarray(
            routes.map((_, index) => index),
            { minLength: 0 },
          ),
        }),
      ),
  );
}

function describeMatch(match: Match | undefined): string {
  return match === undefined
    ? "no handler"
    : `${match.id} with ${JSON.stringify(match.parameters)}`;
}

function resultToMatch(
  result: ReturnType<typeof FindRouteHandler>,
  idOf: ReadonlyMap<RouteCallback, string>,
): Match | undefined {
  if (result === undefined) {
    return undefined;
  }
  if (Array.isArray(result)) {
    throw new Error("A single lookup answered a list of handlers");
  }
  const callback = "handler" in result ? result.handler : result;
  const id = idOf.get(callback);
  assert.ok(id !== undefined, "the lookup answered a handler never registered");
  return {
    id,
    parameters: parametersOf("handler" in result ? result.parameters : {}),
  };
}

function parametersOf(
  parameters: HandlerResult["parameters"],
): Match["parameters"] {
  return Object.getOwnPropertyNames(parameters)
    .sort()
    .map((name): readonly [string, string] => [name, parameters[name]]);
}

function probe(
  probeSpec: ProbeSpec,
  reference: ReferenceRouter,
  idOf: ReadonlyMap<RouteCallback, string>,
): void {
  const { mode, path } = probeSpec;
  const where = `${mode} ${probeSpec.method} /${path.join("/")}`;
  if (mode === "handler" || mode === "websocket") {
    const exactPath = `/${path.join("/")}${probeSpec.trailingSlash && path.length > 0 ? "/" : ""}`;
    const actual = resultToMatch(
      table.findRouteHandler(mode, probeSpec.method, [...path], exactPath),
      idOf,
    );
    const wanted = reference.find(mode, probeSpec.method, path);
    assert.deepStrictEqual(
      actual,
      wanted,
      `${where}: the route table answers ${describeMatch(actual)}, the reference router ${describeMatch(wanted)}`,
    );
    return;
  }
  const actual = table
    .getMultiHandlers(probeSpec.methods, [...path], mode)
    .map((result) => {
      const id = idOf.get(result.handler);
      assert.ok(
        id !== undefined,
        "the lookup answered a handler never registered",
      );
      return { id, parameters: parametersOf(result.parameters) };
    });
  const wanted = reference.collect(mode, probeSpec.methods, path);
  assert.deepStrictEqual(
    actual,
    wanted,
    `${where} through ${probeSpec.methods.join(",")}: the route table collects ${JSON.stringify(actual)}, the reference router ${JSON.stringify(wanted)}`,
  );
}

function probeAll(
  scenario: Scenario,
  reference: ReferenceRouter,
  idOf: ReadonlyMap<RouteCallback, string>,
): void {
  for (const spec of scenario.probes) {
    probe(spec, reference, idOf);
  }
  for (const mode of MODES) {
    assert.strictEqual(
      table.hasHandlers(mode),
      reference.has(mode),
      `hasHandlers("${mode}")`,
    );
  }
}

/** Runs a scenario on a route table of its own: an unregistered route leaves its node in the tree, so the order in which sibling parameters were first created outlives the routes that created them. */
async function runScenario(scenario: Scenario): Promise<void> {
  table = await isolatedRouteTable();
  const reference = new ReferenceRouter();
  const idOf = new Map<RouteCallback, string>();
  const ids = scenario.routes.map((_, index) => `formal-route-tree-${index}`);
  scenario.routes.forEach((route, index) => {
    const callback: RouteCallback = () => ids[index];
    idOf.set(callback, ids[index]);
    const definition: RouteDefinition = {
      mode: route.mode,
      method: route.method,
      location: location(route.segments),
    };
    table.registerHandler(ids[index], definition, callback);
    reference.register(ids[index], route.mode, route.method, route.segments);
  });
  probeAll(scenario, reference, idOf);
  for (const index of scenario.removed) {
    table.unregisterHandler(ids[index]);
    reference.unregister(ids[index]);
  }
  probeAll(scenario, reference, idOf);
  for (const id of ids) {
    table.unregisterHandler(id);
    reference.unregister(id);
  }
  probeAll(scenario, reference, idOf);
}

describe("Route tree against a Map-based reference router", () => {
  it("registers, matches and unregisters like the reference for any segment, method and parameter name", async function () {
    this.timeout(Math.max(MIN_TIMEOUT_MS, RUNS * MS_PER_RUN));
    const outcome = await fc.check(
      fc.asyncProperty(scenarioArbitrary(), runScenario),
      {
        numRuns: RUNS,
        seed: SEED,
      },
    );
    assert.strictEqual(outcome.failed, false, fc.defaultReportMessage(outcome));
  });
});
