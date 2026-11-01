import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, status } from "./client.ts";
import { CUSTOM_DECORATOR_SCENARIO, LEGACY_SCENARIOS, REGISTRATION_SCENARIOS } from "./sources-registration.ts";
import { open, pick, type Json, type JsonRecord, type Session } from "./session.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

export const routeRegistration: Journey = {
  title: "RegisterRoute adds a handler, prefix or parameterised route at run time under its controller, introspection lists it, and UnregisterRoute removes only that route",
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
      same("getRegisteredRouteHandlers lists them with the controller and the deprecated proto", pick(registered.value, "handlers"), [
        { idIsString: true, mode: "handler", method: "post", location: "/dynamic/echo", controller: true, proto: true, callback: "function" },
        { idIsString: true, mode: "handler", method: "get", location: "/dynamic/guarded", controller: true, proto: true, callback: "function" },
        { idIsString: true, mode: "prefix", method: "get", location: "/dynamic/guarded", controller: true, proto: true, callback: "function" },
        { idIsString: true, mode: "handler", method: "get", location: "/dynamic/health", controller: true, proto: true, callback: "function" },
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
    await finish(session);
  },
};

export const customDecorators: Journey = {
  title: "ProcessCallback builds the full path from the controller, registers the handler and returns its id, a location is optional, and the priority levels are 0 to 4",
  entryPoint: "`ProcessCallback(target, key, descriptor, mode, method, location?, priority?)` called by a custom method decorator",
  async run(context) {
    const session = await open(context);
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
    await finish(session);
  },
};

export const legacyProto: Journey = {
  title: "a handler registered the interface-api 0.2 way, with only its proto, takes its controller from proto.constructor: a class, a plain class and an empty object are served, injected properties are filled, and a proto with no usable constructor is refused with a TypeError",
  entryPoint: "`RegisterRoute({ ..., proto })` without `controller`, as a module built against interface-api 0.2 calls it",
  async run(context) {
    const session = await open(context);
    const registered = await session.run("register four legacy routes", LEGACY_SCENARIOS.register);
    context.expect(registered.folder, [holds("the scenario ran", registered.ok, JSON.stringify(registered.error))], { critical: true });
    context.expect(registered.folder, [
      same("every route is registered and its controller is proto.constructor", registered.value, {
        idTypes: ["number", "number", "number", "number"],
        handlers: [
          { location: "/legacy/class", controllerIsProtoConstructor: true, protoIsTheGivenOne: true },
          { location: "/legacy/empty", controllerIsProtoConstructor: true, protoIsTheGivenOne: true },
          { location: "/legacy/plain", controllerIsProtoConstructor: true, protoIsTheGivenOne: true },
          { location: "/legacy/props", controllerIsProtoConstructor: true, protoIsTheGivenOne: true },
        ],
        routes: 4,
      }),
    ]);
    const viaClass = await session.get("GET /legacy/class", "/legacy/class");
    context.expect(viaClass.folder, [status("a legacy controller built by Controller()", viaClass, 200), same("its methods are on the instance the callback gets", viaClass.json, { shout: "LEGACY", location: "/legacy" })]);
    const plain = await session.get("GET /legacy/plain", "/legacy/plain");
    context.expect(plain.folder, [status("a plain class", plain, 200), same("is constructed for the request", plain.json, { made: true, instance: true })]);
    for (const call of [1, 2]) {
      const empty = await session.get(`GET /legacy/empty, call ${String(call)}`, "/legacy/empty");
      context.expect(empty.folder, [status("a proto that is an empty object", empty, 200), bodyIs("is served again on the next request", empty, "legacy webhook")]);
    }
    const props = await session.get("GET /legacy/props?tag=blue", "/legacy/props?tag=blue");
    context.expect(props.folder, [status("computed properties", props, 200), same("fill the instance and the argument", props.json, { prop: "blue", arg: "blue" })]);
    const refused = await session.run("register protos without a usable constructor", LEGACY_SCENARIOS.refused);
    context.expect(refused.folder, [
      same("each is refused with a TypeError and nothing is registered", refused.value, {
        out: [
          { label: "no constructor", refused: true, type: "TypeError" },
          { label: "constructor is a number", refused: true, type: "TypeError" },
          { label: "constructor without a prototype", refused: true, type: "TypeError" },
        ],
        registered: 0,
      }),
    ]);
    const nothing = await session.get("GET /legacy-refused/0", "/legacy-refused/0");
    context.expect(nothing.folder, [holds("a refused route is not served", nothing.status === 404, String(nothing.status))]);
    const left = await session.run("unregister the class route", LEGACY_SCENARIOS.unregister);
    context.expect(left.folder, [same("UnregisterRoute removes a legacy route and keeps the others", left.value, ["/legacy/empty", "/legacy/plain", "/legacy/props"])]);
    const gone = await session.get("GET /legacy/class after unregistering", "/legacy/class");
    context.expect(gone.folder, [holds("the unregistered legacy route is not served", gone.status === 404, String(gone.status))]);
    await finish(session);
  },
};
