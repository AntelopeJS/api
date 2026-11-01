import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, status, type Reply } from "./client.ts";
import { open, type Json, type Session } from "./session.ts";
import { ROUTES_SOURCE } from "./sources-routes.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

/** Sends a request and checks its status and JSON body in one step. */
interface Call {
  label: string;
  method: string;
  route: string;
  code: number;
  expected: Json;
}

async function expectJson(session: Session, call: Call): Promise<Reply> {
  const { label, method, route, code, expected } = call;
  const reply = await session.get(`${method} ${route}`, route, { method });
  session.context.expect(reply.folder, [status(label, reply, code), same(`${label}: JSON body`, reply.json, expected)]);
  return reply;
}

export const routeForms: Journey = {
  title: "an omitted location uses the method name, an empty one registers the controller root, :names capture path segments, and every verb and custom @Route method reaches its handler",
  entryPoint: "`@Get()`, `@Get(\"\")`, `@Get(\":id\")`, `@Post()`, `@Put`, `@Delete` and `@Route(\"handler\", \"patch\", ...)` on a controller, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: ROUTES_SOURCE });
    await expectJson(session, { label: "omitted location uses the method name", method: "GET", route: "/users/listUsers", code: 200, expected: { users: ["user1", "user2"] } });
    await expectJson(session, { label: "empty location is the controller root", method: "GET", route: "/users", code: 200, expected: { where: "root" } });
    await expectJson(session, { label: "a relative :id", method: "GET", route: "/users/user123", code: 200, expected: { id: "user123" } });
    await expectJson(session, { label: "two named segments", method: "GET", route: "/users/u1/posts/p9", code: 200, expected: { userId: "u1", postId: "p9" } });
    const created = await session.get("POST /users/createUser", "/users/createUser", { method: "POST" });
    context.expect(created.folder, [status("POST with an omitted location", created, 201), same("the created body", created.json, { id: "new-user-id" })]);
    await expectJson(session, { label: "PUT", method: "PUT", route: "/users/abc", code: 200, expected: { replaced: "abc" } });
    const deleted = await session.get("DELETE /users/abc", "/users/abc", { method: "DELETE" });
    context.expect(deleted.folder, [status("DELETE answering HTTPResult(204)", deleted, 204), bodyIs("a 204 has no body", deleted, "")]);
    await expectJson(session, { label: "a location with a leading slash is relative to the controller", method: "GET", route: "/users/lead/zed", code: 200, expected: { lead: "zed" } });
    await expectJson(session, { label: "a custom method through @Route", method: "PATCH", route: "/users/abc/nickname", code: 200, expected: { patched: "abc" } });
    const other = await session.get("GET /orders/o1 on a second controller", "/orders/o1");
    context.expect(other.folder, [status("second controller", other, 200), same("second controller body", other.json, { order: "o1" })]);
    await expectJson(session, { label: "the second controller's root", method: "GET", route: "/orders", code: 200, expected: { where: "orders" } });
    const wrongVerb = await session.get("POST /orders/o1, registered for GET only", "/orders/o1", { method: "POST" });
    context.expect(wrongVerb.folder, [holds("a verb no route registered is not served", wrongVerb.status === 404, `status ${String(wrongVerb.status)}`)]);
    const reversed = await session.get("GET /orders/submit/form, registered for POST only", "/orders/submit/form");
    context.expect(reversed.folder, [holds("a GET does not reach a POST route", reversed.status === 404, `status ${String(reversed.status)}, body ${reversed.text}`)]);
    const submitted = await session.get("POST /orders/submit/form", "/orders/submit/form", { method: "POST" });
    context.expect(submitted.folder, [status("the POST route", submitted, 200), same("is served", submitted.json, { submitted: true })]);
    const unknown = await session.get("GET /nowhere", "/nowhere");
    context.expect(unknown.folder, [holds("a path no route registered is 404", unknown.status === 404, `status ${String(unknown.status)}`)]);
    const decoded = await session.get("GET /users/with%20space", "/users/with%20space");
    context.expect(decoded.folder, [holds("a path segment with an escaped space still reaches :id", decoded.status === 200, `status ${String(decoded.status)}, body ${decoded.text}`)]);
    await finish(session);
  },
};

export const controllerTree: Journey = {
  title: "extend nests a sub-controller under its parent's path at any depth, PartialController adds routes at the same location, and Controller(location, Base) gives handlers a Base instance",
  entryPoint: "`ApiController.extend(\"users\")`, `PartialController(UsersController)` and `Controller(location, Base)` declared in a module",
  async run(context) {
    const session = await open(context, { controllers: ROUTES_SOURCE });
    await expectJson(session, { label: "the parent controller keeps its own path", method: "GET", route: "/api", code: 200, expected: { level: "api" } });
    await expectJson(session, { label: "a sub-controller sits under its parent", method: "GET", route: "/api/users", code: 200, expected: { level: "api/users" } });
    await expectJson(session, { label: "a sub-controller of a sub-controller", method: "GET", route: "/api/users/admin", code: 200, expected: { level: "api/users/admin" } });
    const statics = await session.run("read the sub-controller's location and static members", "return { location: controllers.ApiUsersAdminController.location, parent: controllers.ApiController.location, version: controllers.ApiUsersController.version };");
    context.expect(statics.folder, [same("a sub-controller has its full location and its parent's static members", statics.value, { location: "/api/users/admin", parent: "/api", version: "v1" })]);
    await expectJson(session, { label: "the original controller's route", method: "GET", route: "/reports/daily", code: 200, expected: { report: "daily" } });
    await expectJson(session, { label: "a partial controller's route shares the location", method: "GET", route: "/reports/admin", code: 200, expected: { report: "admin" } });
    await expectJson(session, { label: "instances of Controller(location, Base) are Base instances", method: "GET", route: "/typed", code: 200, expected: { said: "hi from the base class" } });
    await finish(session);
  },
};

