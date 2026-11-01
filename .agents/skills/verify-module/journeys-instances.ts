import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { status } from "./client.ts";
import { open, type Session } from "./session.ts";
import { INSTANCES_SOURCE } from "./sources-instances.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

export const controllerInstances: Journey = {
  title: "each request builds a new controller instance, GetControllerInstance returns the instance of the current request with its injected properties filled, and asking twice returns the same one",
  entryPoint: "`GetControllerInstance(Controller, context)` called from another controller's handler, over HTTP",
  async run(context) {
    const session = await open(context, { controllers: INSTANCES_SOURCE });
    const first = await session.get("GET /users/count", "/users/count");
    const second = await session.get("GET /users/count again", "/users/count");
    context.expect(second.folder, [same("a first request counts one hit", first.json, { hits: 1 }), same("a second request starts from a new instance", second.json, { hits: 1 })]);
    const order = await session.get("GET /orders/o-1 with a viewer header", "/orders/o-1", { headers: { "x-user": "ada" } });
    context.expect(order.folder, [status("another controller's instance", order, 200), same("its method works and its injected property is filled for this request", order.json, { order: { id: "o-1", user: { id: "user-123", name: "Example User", viewer: "ada" } } })]);
    const anonymous = await session.get("GET /orders/o-2 without the header", "/orders/o-2");
    context.expect(anonymous.folder, [same("the next request does not keep the previous viewer", anonymous.json, { order: { id: "o-2", user: { id: "user-123", name: "Example User" } } })]);
    const twice = await session.get("GET /orders/twice/o-3", "/orders/twice/o-3");
    context.expect(twice.folder, [same("two calls in one request give one instance", twice.json, { same: true, hits: 2 })]);
    const built = await session.run("count the constructed instances", "return controllers.built.length;");
    context.expect(built.folder, [holds("an instance is built per request that needs it", built.value === 5, JSON.stringify(built.value))]);
    const reach = await session.get("GET /reach/extended", "/reach/extended");
    context.expect(reach.folder, [status("classes built by extend and PartialController", reach, 200), same("both give an instance", reach.json, { extended: "api users", partial: true })]);
    await finish(session);
  },
};
