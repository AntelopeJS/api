import { type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, header, headerIs, status } from "./client.ts";
import { talk } from "./journeys-websocket.ts";
import { open } from "./session.ts";
import { GATE_SOURCE } from "./sources-gate.ts";

const APP = "https://app.example.com";

export const startupGate: Journey = {
  title: "until every module has started, every request is answered 503 error.server_starting with Retry-After 1 and nothing runs, while /_live answers 200 and a CORS preflight is answered; then requests are served, and the gate closes again when the project stops",
  entryPoint: "requests sent while a module is still starting and while the project is stopping",
  async run(context) {
    const session = await open(context, { controllers: GATE_SOURCE, config: { cors: { allowedOrigins: APP } }, startDelayMs: 4500, stopDelayMs: 4500 });
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
    const stopped = await stopping;
    context.expect(stopped.folder, [holds("the project stopped on SIGINT", stopped.exitCode === 130 || stopped.signal === "SIGINT", `exit ${String(stopped.exitCode)}, signal ${String(stopped.signal)}`)]);
  },
};
