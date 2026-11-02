import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, header, headerIs, status } from "./client.ts";
import { talk } from "./journeys-websocket.ts";
import { attempt, open } from "./session.ts";
import { GATE_SOURCE, OWNED_MODULE } from "./sources-gate.ts";

const APP = "https://app.example.com";

export const startupGate: Journey = {
  title: "the API port is bound before other modules construct, and until every module has started, every request is answered 503 error.server_starting with Retry-After 1 and nothing runs, while /_live answers 200 and a CORS preflight is answered; then requests are served, and the gate closes again when the project stops while /_live still answers 200",
  entryPoint: "requests sent while a module is still starting and while the project is stopping",
  async run(context) {
    const session = await open(context, { controllers: GATE_SOURCE, config: { cors: { allowedOrigins: APP } }, appConfig: { connectAtConstruct: "${@api.API_PORT}" }, startDelayMs: 4500, stopDelayMs: 4500 });
    const held = await session.get("GET /ping while a module starts", "/ping");
    context.expect(held.folder, [status("a request is held back", held, 503), bodyIs("with the documented body", held, "error.server_starting"), headerIs("and Retry-After", held, "retry-after", "1")]);
    const posted = await session.get("POST /ping while a module starts", "/ping", { method: "POST", body: "{}" });
    context.expect(posted.folder, [status("a write is held back too", posted, 503), bodyIs("with the same body", posted, "error.server_starting")]);
    const live = await session.get("GET /_live while a module starts", "/_live");
    context.expect(live.folder, [status("liveness", live, 200)]);
    const unknown = await session.get("GET /nowhere while a module starts", "/nowhere");
    context.expect(unknown.folder, [status("even a path without a route is held back", unknown, 503)]);
    const preflight = await session.get("OPTIONS /ping while a module starts", "/ping", { method: "OPTIONS", headers: { origin: APP, "access-control-request-method": "POST" } });
    context.expect(preflight.folder, [holds("a preflight is answered", preflight.status === 204 || preflight.status === 200, String(preflight.status)), headerIs("with the CORS headers", preflight, "access-control-allow-origin", APP)]);
    const cross = await session.get("GET /ping from a listed origin while a module starts", "/ping", { headers: { origin: APP } });
    context.expect(cross.folder, [status("the 503", cross, 503), headerIs("is readable by the browser", cross, "access-control-allow-origin", APP)]);
    const socket = await talk(session, "ws while a module starts", { route: "/socket", expect: 1 });
    context.expect(socket.folder, [holds("a WebSocket is not upgraded while the gate is closed", !JSON.stringify(socket.parsed).includes('"opened":true'), JSON.stringify(socket.parsed))]);
    const early = await session.run("read what the consumer saw from its construct", "return config.constructProbe;");
    context.expect(early.folder, [same("the API port accepts connections before any other module constructs", early.value, "connected")]);
    const nothing = await session.run("count what ran", "return controllers.hits;");
    context.expect(nothing.folder, [same("nothing ran for the held requests", nothing.value, [])]);

    await session.run("wait for the start to settle", "await waitFor(5200); return null;");
    const served = await session.get("GET /ping after the start", "/ping");
    context.expect(served.folder, [status("served once every module started", served, 200), same("the route answers", served.json, { ok: true }), holds("without a Retry-After", header(served, "retry-after") === undefined, String(header(served, "retry-after")))]);
    const live2 = await session.get("GET /_live after the start, a route a module also declared", "/_live");
    context.expect(live2.folder, [status("the liveness path is reserved: the probe still answers", live2, 200)]);
    const after = await session.run("count what ran after the start", "return controllers.hits;");
    context.expect(after.folder, [same("only the served request ran, not the module's own /_live", after.value, ["get"])]);

    const stopping = session.stop();
    const closing = await session.get("GET /ping while the project stops", "/ping");
    context.expect(closing.folder, [status("the gate closes when the project starts stopping", closing, 503), bodyIs("with the same body", closing, "error.server_starting"), headerIs("and Retry-After", closing, "retry-after", "1")]);
    const liveStopping = await session.get("GET /_live while the project stops", "/_live");
    context.expect(liveStopping.folder, [status("/_live always answers 200, also while the project stops", liveStopping, 200)]);
    const stopped = await stopping;
    context.expect(stopped.folder, [holds("the project stopped on SIGINT", stopped.exitCode === 130 || stopped.signal === "SIGINT", `exit ${String(stopped.exitCode)}, signal ${String(stopped.signal)}`)]);
  },
};

const FAILED_START_PROBE = String.raw`seen=""
for i in $(seq 1 80); do
  seen="$seen $(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:$PORT/ping")"
  kill -0 $PID 2>/dev/null || break
  sleep 0.1
done
echo "seen=$seen"`;

export const failedStart: Journey = {
  title: "a module whose start fails leaves the gate closed: requests are answered 503 and never served",
  entryPoint: "a consumer module whose `start()` throws after 2 s, called over HTTP until the project ends",
  async run(context) {
    const failed = await attempt(context, "dev", { controllers: GATE_SOURCE, startDelayMs: 2000, startFails: true }, FAILED_START_PROBE);
    const seen = /^seen=(.*)$/m.exec(failed.stdout)?.[1] ?? "";
    context.expect(failed.folder, [holds("the probe ran while the module started", failed.ready && seen !== "", failed.stdout.slice(0, 400)), holds("requests are held back with 503", seen.split(" ").includes("503"), seen), holds("no request is ever served after the start failed", !seen.split(" ").includes("200"), seen)]);
  },
};

const LIFECYCLE = {
  owners: "return api.getRegisteredRoutes().filter((r) => r.location === \"/owned/route\" || r.location.startsWith(\"/ping\")).map((r) => r.location.replace(/\\/$/, \"\") + \" \" + r.module).sort();",
  stop: "await load(\"@antelopejs/interface-core/modules\").StopModule(\"verify-extra\"); return true;",
  start: "await load(\"@antelopejs/interface-core/modules\").StartModule(\"verify-extra\"); return true;",
  reopen: "const m = load(\"@antelopejs/interface-core/modules\"); await m.StopModule(\"verify-driver\"); await m.StartModule(\"verify-driver\"); return true;",
  destroy: "const m = load(\"@antelopejs/interface-core/modules\"); await m.StopModule(\"verify-extra\"); await m.DestroyModule(\"verify-extra\"); return api.getRegisteredRoutes().filter((r) => r.location === \"/owned/route\" || r.location.startsWith(\"/ping\")).map((r) => r.location.replace(/\\/$/, \"\") + \" \" + r.module).sort();",
};

export const moduleLifecycle: Journey = {
  title: "with core 1.17.0, stopping a single module at runtime closes the gate and starting it reopens it, and destroying the module releases the routes it owns, unlisted and no longer served, while the other modules' routes stay",
  entryPoint: "`StopModule`, `StartModule` and `DestroyModule` of `@antelopejs/interface-core/modules` on a second module that registered a route",
  async run(context) {
    const session = await open(context, { controllers: GATE_SOURCE, extra: OWNED_MODULE });
    const owned = await session.get("GET /owned/route", "/owned/route");
    context.expect(owned.folder, [status("a route another module registered", owned, 200), same("answers", owned.json, { owned: true })]);
    const owners = await session.run("read the owners", LIFECYCLE.owners);
    context.expect(owners.folder, [same("each route is owned by the module that registered it", owners.value, ["/owned/route verify-extra", "/ping verify-app", "/ping verify-app"])]);
    const stopped = await session.run("stop the second module", LIFECYCLE.stop);
    context.expect(stopped.folder, [holds("the scenario ran", stopped.ok, JSON.stringify(stopped.error))], { critical: true });
    const closed = await session.get("GET /ping after StopModule", "/ping");
    context.expect(closed.folder, [status("the core release that introduced the gate closes it when a single module stops", closed, 503), bodyIs("with the gate's body", closed, "error.server_starting")]);
    const started = await session.run("start the second module again", LIFECYCLE.start);
    context.expect(started.folder, [holds("the scenario ran", started.ok, JSON.stringify(started.error))], { critical: true });
    const reopened = await session.get("GET /ping after StartModule", "/ping");
    context.expect(reopened.folder, [status("starting it again reopens the gate", reopened, 200), same("the route answers", reopened.json, { ok: true })]);
    const destroyed = await session.run("stop and destroy the second module", LIFECYCLE.destroy);
    context.expect(destroyed.folder, [same("module cleanup removes the routes it owns and keeps the others", destroyed.value, ["/ping verify-app", "/ping verify-app"])]);
    const cycled = await session.run("restart another module, which reopens the gate", LIFECYCLE.reopen);
    context.expect(cycled.folder, [holds("the scenario ran", cycled.ok, JSON.stringify(cycled.error))], { critical: true });
    const released = await session.get("GET /owned/route after DestroyModule", "/owned/route");
    context.expect(released.folder, [status("the released route is no longer served", released, 404)]);
    const kept = await session.get("GET /ping after DestroyModule", "/ping");
    context.expect(kept.folder, [status("the other module's route still is", kept, 200)]);
    const stop = await session.stop();
    context.expect(stop.folder, [interrupted(stop)]);
  },
};
