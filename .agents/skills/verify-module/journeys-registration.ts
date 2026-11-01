import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, status } from "./client.ts";
import { CONTROLLER_REQUIRED_SCENARIO, CUSTOM_DECORATOR_SCENARIO, REGISTRATION_SCENARIOS, ROUTE_PRIORITY_SOURCE, TWIN_SCENARIOS } from "./sources-registration.ts";
import { open, pick, type Json, type JsonRecord, type Session } from "./session.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

export const routeRegistration: Journey = {
  title: "RegisterRoute adds a handler, prefix or parameterised route at run time under its controller, introspection lists it with the registering module as owner, and UnregisterRoute removes only that route, also beside another handler at the same location",
  entryPoint: "`RegisterRoute(handler)` and `UnregisterRoute(id)` called from a module while the project runs",
  async run(context) {
    const session = await open(context);
    const registered = await session.run("register four routes", REGISTRATION_SCENARIOS.register);
    context.expect(registered.folder, [holds("the scenario ran", registered.ok, JSON.stringify(registered.error))], { critical: true });
    context.expect(registered.folder, [same("the ids are distinct", pick(registered.value, "distinct"), 4)]);
    const routeRow = (location: string, method: string, callbackName: string, parameters: number, priority?: number): Json => {
      const row: JsonRecord = { idIsString: true, idMatches: true, location, method, callbackName, parameters, properties: 0, moduleIsString: true };
      if (priority !== undefined) row.priority = priority;
      return row;
    };
    context.expect(registered.folder, [
      same("RegisterRoute returns a number for each route", pick(registered.value, "idTypes"), ["number", "number", "number", "number"]),
      same("getRegisteredRoutes lists the four registrations", pick(registered.value, "routes"), [
        routeRow("/dynamic/echo", "post", "echoCallback", 1),
        routeRow("/dynamic/guarded", "get", "guardCallback", 0, 0),
        routeRow("/dynamic/guarded", "get", "guardedCallback", 0),
        routeRow("/dynamic/health", "get", "healthCallback", 0),
      ]),
      same("getRegisteredRouteHandlers lists them with the controller they were registered under and no proto field", pick(registered.value, "handlers"), [
        { idIsString: true, mode: "handler", method: "post", location: "/dynamic/echo", controller: true, proto: false, callback: "function" },
        { idIsString: true, mode: "handler", method: "get", location: "/dynamic/guarded", controller: true, proto: false, callback: "function" },
        { idIsString: true, mode: "prefix", method: "get", location: "/dynamic/guarded", controller: true, proto: false, callback: "function" },
        { idIsString: true, mode: "handler", method: "get", location: "/dynamic/health", controller: true, proto: false, callback: "function" },
      ]),
    ]);
    const health = await session.get("GET /dynamic/health", "/dynamic/health");
    context.expect(health.folder, [status("a registered route", health, 200), same("answers from its callback", health.json, { healthy: true })]);
    const echo = await session.get("POST /dynamic/echo?n=7", "/dynamic/echo?n=7", { method: "POST" });
    context.expect(echo.folder, [status("a route with a computed parameter", echo, 200), same("receives the parameter's value", echo.json, { n: "7" })]);
    const guarded = await session.get("GET /dynamic/guarded", "/dynamic/guarded");
    context.expect(guarded.folder, [status("a registered prefix", guarded, 401), same("answers before the registered handler", guarded.json, { error: "guarded" })]);
    const introspection = await session.run("read the registry twice", REGISTRATION_SCENARIOS.introspection);
    context.expect(introspection.folder, [same("every call returns a new array, handlers are shared references", introspection.value, { freshArrays: true, mutationIgnored: true, handlersShared: true, handlerArraysFresh: true, ownRoutes: 4 })]);
    const removed = await session.run("unregister /dynamic/health", REGISTRATION_SCENARIOS.unregisterHealth);
    context.expect(removed.folder, [same("both introspection functions drop it and keep the others", removed.value, { routes: ["/dynamic/echo post", "/dynamic/guarded get", "/dynamic/guarded get"], handlers: ["/dynamic/echo post", "/dynamic/guarded get", "/dynamic/guarded get"] })]);
    const gone = await session.get("GET /dynamic/health after unregistering", "/dynamic/health");
    context.expect(gone.folder, [holds("the unregistered route is not served", gone.status === 404, String(gone.status))]);
    const stillThere = await session.get("POST /dynamic/echo?n=8", "/dynamic/echo?n=8", { method: "POST" });
    context.expect(stillThere.folder, [same("its neighbours are untouched", stillThere.json, { n: "8" })]);
    await session.run("unregister the prefix", REGISTRATION_SCENARIOS.unregisterGuard);
    const open2 = await session.get("GET /dynamic/guarded after removing the prefix", "/dynamic/guarded");
    context.expect(open2.folder, [status("without the prefix", open2, 200), same("the handler answers", open2.json, { guarded: true })]);
    const left = await session.run("unregister the rest", REGISTRATION_SCENARIOS.unregisterRest);
    context.expect(left.folder, [same("nothing of the dynamic routes is left", left.value, 0)]);
    const last = await session.get("GET /dynamic/guarded after removing every route", "/dynamic/guarded");
    context.expect(last.folder, [holds("the last route is gone", last.status === 404, String(last.status))]);
    const twins = await session.run("register two prefixes and a handler at one location, and a route claiming another owner", TWIN_SCENARIOS.register);
    context.expect(twins.folder, [holds("the scenario ran", twins.ok, JSON.stringify(twins.error)), same("RegisterRoute takes the owner from the registering module, not the handler's module field", twins.value, ["verify-app"])], { critical: true });
    const both = await session.get("GET /twin/x", "/twin/x");
    context.expect(both.folder, [status("the handler", both, 200), same("both prefixes ran", both.json, ["a", "b"])]);
    await session.run("unregister the first prefix", TWIN_SCENARIOS.dropA);
    const one = await session.get("GET /twin/x after unregistering the first prefix", "/twin/x");
    context.expect(one.folder, [status("the handler", one, 200), same("UnregisterRoute removes that route only: the other prefix at the same location still runs", one.json, ["b"])]);
    await finish(session);
  },
};

export const customDecorators: Journey = {
  title: "ProcessCallback builds the full path from the controller, registers the handler and returns its id, a location is optional, the priority levels are 0 to 4, and @Route orders handlers by its priority argument",
  entryPoint: "`ProcessCallback(target, key, descriptor, mode, method, location?, priority?)` called by a custom method decorator",
  async run(context) {
    const session = await open(context, { controllers: ROUTE_PRIORITY_SOURCE });
    const built = await session.run("register through ProcessCallback", CUSTOM_DECORATOR_SCENARIO);
    context.expect(built.folder, [
      same("it returns { id } and registers both routes under the controller", built.value, {
        helloKeys: ["id"],
        helloId: "number",
        namedId: "number",
        distinct: true,
        rows: [
          { location: "/proc/custom/path", method: "post", callbackName: "named", priority: 1 },
          { location: "/proc/hello", method: "get", callbackName: "hello" },
        ],
        priorities: [0, 1, 2, 3, 4],
      }),
    ]);
    const hello = await session.get("GET /proc/hello", "/proc/hello");
    context.expect(hello.folder, [status("an omitted location is the key", hello, 200), same("answers from its callback", hello.json, { hello: true })]);
    const named = await session.get("POST /proc/custom/path", "/proc/custom/path", { method: "POST" });
    context.expect(named.folder, [status("a given location", named, 200), same("answers from its callback", named.json, { named: true })]);
    const order = await session.get("GET /route-priority/order", "/route-priority/order");
    context.expect(order.folder, [status("@Route prefixes", order, 200), same("@Route takes a priority, and one without runs at NORMAL", order.json, ["high", "default", "low"])]);
    await finish(session);
  },
};

export const controllerRequired: Journey = {
  title: "RegisterRoute needs the controller class that declares the route: a handler with no controller, or with only the removed proto field, is refused with a TypeError and registers nothing, while the same handler with its controller is registered, listed and removable",
  entryPoint: "`RegisterRoute({ ..., controller })` and `RegisterRoute({ ..., proto })` called from a module while the project runs",
  async run(context) {
    const session = await open(context);
    const attempted = await session.run("register handlers with and without a controller", CONTROLLER_REQUIRED_SCENARIO);
    context.expect(attempted.folder, [holds("the scenario ran", attempted.ok, JSON.stringify(attempted.error))], { critical: true });
    context.expect(attempted.folder, [
      same("each handler without a controller is refused with a TypeError, the one with a controller is listed under it", attempted.value, {
        out: [
          { label: "no controller and no proto", refused: true, type: "TypeError" },
          { label: "only a proto built by Controller", refused: true, type: "TypeError" },
          { label: "only a proto of a plain class", refused: true, type: "TypeError" },
          { label: "only an empty proto", refused: true, type: "TypeError" },
        ],
        handlers: [{ location: "/needs-controller/ok", controllerIsDeclared: true }],
        routes: ["/needs-controller/ok"],
      }),
    ]);
    const refused = await session.get("GET /needs-controller/1", "/needs-controller/1");
    context.expect(refused.folder, [holds("a refused route is not served", refused.status === 404, String(refused.status))]);
    const served = await session.get("GET /needs-controller/ok", "/needs-controller/ok");
    context.expect(served.folder, [status("the handler with its controller", served, 200), bodyIs("answers from its callback", served, "with a controller")]);
    await finish(session);
  },
};
