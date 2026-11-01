export const REGISTRATION_SCENARIOS = {
  register: String.raw`const { Controller, HTTPResult, RegisterRoute, getRegisteredRouteHandlers, getRegisteredRoutes } = api;
class DynamicController extends Controller("/dynamic") {}
globalThis.dynamic = { DynamicController };
function healthCallback() { return { healthy: true }; }
function echoCallback(n) { return { n }; }
function guardCallback() { return new HTTPResult(401, { error: "guarded" }); }
function guardedCallback() { return { guarded: true }; }
const queryParameter = { provider: (context) => context.url.searchParams.get("n"), modifiers: [] };
const ids = {
  health: RegisterRoute({ mode: "handler", method: "get", location: "/dynamic/health", callback: healthCallback, parameters: [], properties: {}, controller: DynamicController }),
  echo: RegisterRoute({ mode: "handler", method: "post", location: "/dynamic/echo", callback: echoCallback, parameters: [queryParameter], properties: {}, controller: DynamicController }),
  guard: RegisterRoute({ mode: "prefix", method: "get", location: "/dynamic/guarded", callback: guardCallback, parameters: [], properties: {}, controller: DynamicController, priority: 0 }),
  guarded: RegisterRoute({ mode: "handler", method: "get", location: "/dynamic/guarded", callback: guardedCallback, parameters: [], properties: {}, controller: DynamicController }),
};
globalThis.dynamic.ids = ids;
const routes = getRegisteredRoutes().filter((route) => route.location.startsWith("/dynamic")).map((route) => ({ idIsString: typeof route.id === "string", idMatches: Object.values(ids).map(String).includes(route.id), location: route.location, method: route.method, callbackName: route.callbackName, parameters: route.parameters.length, properties: Object.keys(route.properties).length, priority: route.priority, moduleIsString: typeof route.module === "string" })).sort((a, b) => (a.location + a.method + a.callbackName).localeCompare(b.location + b.method + b.callbackName));
const handlers = getRegisteredRouteHandlers().filter((entry) => entry.handler.location.startsWith("/dynamic")).map((entry) => ({ idIsString: typeof entry.id === "string", mode: entry.handler.mode, method: entry.handler.method, location: entry.handler.location, controller: entry.handler.controller === DynamicController, proto: entry.handler.proto === DynamicController.prototype, callback: typeof entry.handler.callback })).sort((a, b) => (a.location + a.mode).localeCompare(b.location + b.mode));
return { idTypes: Object.values(ids).map((id) => typeof id), distinct: new Set(Object.values(ids)).size, routes, handlers };`,
  introspection: String.raw`const { getRegisteredRoutes, getRegisteredRouteHandlers } = api;
const own = (route) => route.location.startsWith("/dynamic");
const a = getRegisteredRoutes();
const b = getRegisteredRoutes();
const lengthBefore = b.length;
a.length = 0;
a.push({ junk: true });
const c = getRegisteredRoutes();
const h1 = getRegisteredRouteHandlers();
const h2 = getRegisteredRouteHandlers();
const entry1 = h1.find((entry) => entry.handler.location === "/dynamic/health");
const entry2 = h2.find((entry) => entry.handler.location === "/dynamic/health");
h1.length = 0;
return { freshArrays: a !== b && b !== c, mutationIgnored: c.length === lengthBefore && c.every((route) => route.id !== undefined), handlersShared: entry1.handler === entry2.handler, handlerArraysFresh: h1 !== h2 && getRegisteredRouteHandlers().length === h2.length, ownRoutes: c.filter(own).length };`,
  unregisterHealth: String.raw`const { UnregisterRoute, getRegisteredRoutes, getRegisteredRouteHandlers } = api;
UnregisterRoute(globalThis.dynamic.ids.health);
const left = (list) => list.filter((route) => route.location.startsWith("/dynamic")).map((route) => route.location + " " + route.method).sort();
return { routes: left(getRegisteredRoutes()), handlers: getRegisteredRouteHandlers().map((entry) => entry.handler).filter((handler) => handler.location.startsWith("/dynamic")).map((handler) => handler.location + " " + handler.method).sort() };`,
  unregisterGuard: String.raw`api.UnregisterRoute(globalThis.dynamic.ids.guard); return null;`,
  unregisterRest: String.raw`const { UnregisterRoute, getRegisteredRoutes } = api;
UnregisterRoute(globalThis.dynamic.ids.echo);
UnregisterRoute(globalThis.dynamic.ids.guarded);
return getRegisteredRoutes().filter((route) => route.location.startsWith("/dynamic")).length;`,
};

export const CUSTOM_DECORATOR_SCENARIO = String.raw`const { Controller, HandlerPriority, ProcessCallback, getRegisteredRoutes } = api;
class ProcController extends Controller("/proc") {}
const hello = ProcessCallback(ProcController.prototype, "hello", { value: function hello() { return { hello: true }; } }, "handler", "get");
const named = ProcessCallback(ProcController.prototype, "named", { value: function named() { return { named: true }; } }, "handler", "post", "custom/path", HandlerPriority.HIGH);
const rows = getRegisteredRoutes().filter((route) => route.location.startsWith("/proc")).map((route) => ({ location: route.location, method: route.method, callbackName: route.callbackName, priority: route.priority })).sort((a, b) => a.location.localeCompare(b.location));
return { helloKeys: Object.keys(hello), helloId: typeof hello.id, namedId: typeof named.id, distinct: hello.id !== named.id, rows, priorities: [HandlerPriority.HIGHEST, HandlerPriority.HIGH, HandlerPriority.NORMAL, HandlerPriority.LOW, HandlerPriority.LOWEST] };`;

export const LEGACY_SCENARIOS = {
  register: String.raw`const { Controller, RegisterRoute, getRegisteredRouteHandlers, getRegisteredRoutes } = api;
class Legacy extends Controller("/legacy") {
  shout() { return "LEGACY"; }
}
class Plain {
  constructor() { this.made = true; }
}
const emptyProto = {};
globalThis.legacy = { Legacy, Plain, emptyProto };
const tag = { provider: (context) => context.url.searchParams.get("tag"), modifiers: [] };
const base = { mode: "handler", method: "get", parameters: [], properties: {} };
const ids = {
  viaClass: RegisterRoute({ ...base, location: "/legacy/class", callback: function viaClass() { return { shout: this.shout(), location: this.constructor.location }; }, proto: Legacy.prototype }),
  plain: RegisterRoute({ ...base, location: "/legacy/plain", callback: function viaPlain() { return { made: this.made === true, instance: this instanceof Plain }; }, proto: Plain.prototype }),
  empty: RegisterRoute({ ...base, location: "/legacy/empty", callback: function viaEmpty() { return "legacy webhook"; }, proto: emptyProto }),
  props: RegisterRoute({ ...base, location: "/legacy/props", callback: function viaProps(arg) { return { prop: this.tag, arg }; }, parameters: [tag], properties: { tag }, proto: Plain.prototype }),
};
globalThis.legacy.ids = ids;
const handlers = getRegisteredRouteHandlers().filter((entry) => entry.handler.location.startsWith("/legacy")).map((entry) => ({ location: entry.handler.location, controllerIsProtoConstructor: entry.handler.controller === entry.handler.proto.constructor, protoIsTheGivenOne: entry.handler.proto === (entry.handler.location === "/legacy/empty" ? emptyProto : entry.handler.location === "/legacy/class" ? Legacy.prototype : Plain.prototype) })).sort((a, b) => a.location.localeCompare(b.location));
return { idTypes: Object.values(ids).map((id) => typeof id), handlers, routes: getRegisteredRoutes().filter((route) => route.location.startsWith("/legacy")).length };`,
  refused: String.raw`const { RegisterRoute, getRegisteredRoutes } = api;
const cases = [["no constructor", Object.create(null)], ["constructor is a number", { constructor: 42 }], ["constructor without a prototype", { constructor: () => 1 }]];
const out = [];
for (const [label, proto] of cases) {
  try {
    RegisterRoute({ mode: "handler", method: "get", location: "/legacy-refused/" + out.length, callback: function refused() { return "never"; }, parameters: [], properties: {}, proto });
    out.push({ label, refused: false });
  } catch (error) {
    out.push({ label, refused: true, type: error.constructor.name });
  }
}
return { out, registered: getRegisteredRoutes().filter((route) => route.location.startsWith("/legacy-refused")).length };`,
  unregister: String.raw`api.UnregisterRoute(globalThis.legacy.ids.viaClass); return api.getRegisteredRoutes().filter((route) => route.location.startsWith("/legacy/")).map((route) => route.location).sort();`,
};

/** Two prefixes and a handler at one location, a route claiming another owner, and the removal of one prefix. */
export const TWIN_SCENARIOS = {
  register: String.raw`const { Controller, RegisterRoute } = api;
class Twin extends Controller("/twin") {}
const base = { method: "get", parameters: [], properties: {}, controller: Twin };
globalThis.twinLog = [];
globalThis.twin = {
  a: RegisterRoute({ ...base, mode: "prefix", location: "/twin/x", callback: function tagA() { globalThis.twinLog.push("a"); } }),
  b: RegisterRoute({ ...base, mode: "prefix", location: "/twin/x", callback: function tagB() { globalThis.twinLog.push("b"); } }),
  h: RegisterRoute({ ...base, mode: "handler", location: "/twin/x", callback: function main() { return globalThis.twinLog.splice(0); } }),
  claimed: RegisterRoute({ ...base, mode: "handler", location: "/twin/claimed", callback: function claimed() { return 1; }, module: "intruder" }),
};
return api.getRegisteredRoutes().filter((r) => r.location === "/twin/claimed").map((r) => r.module);`,
  dropA: String.raw`api.UnregisterRoute(globalThis.twin.a); return true;`,
};

/** Prefixes registered by \`@Route\` with and without a priority. */
export const ROUTE_PRIORITY_SOURCE = String.raw`import { Controller, Get, HandlerPriority, Route } from "@antelopejs/interface-api";

export const log: string[] = [];

export class RoutePriorityController extends Controller("/route-priority") {
  @Route("prefix", "get", "order", HandlerPriority.LOW)
  low() {
    log.push("low");
  }

  @Route("prefix", "get", "order")
  byDefault() {
    log.push("default");
  }

  @Route("prefix", "get", "order", HandlerPriority.HIGH)
  high() {
    log.push("high");
  }

  @Get("order")
  order() {
    return log.splice(0);
  }
}
`;
