import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, status } from "./client.ts";
import { pem } from "./journeys-servers.ts";
import { parseJson, pick } from "./json.ts";
import { open, pickPorts, type Json, type Session } from "./session.ts";
import { WEBSOCKET_SOURCE } from "./sources-ws.ts";

const SCRIPT = String.raw`const WebSocket = require("ws");
const spec = JSON.parse(process.argv[1]);
const out = { opened: false, messages: [], closeCode: null, error: null };
const socket = new WebSocket(spec.url, { rejectUnauthorized: false });
const done = () => { console.log(JSON.stringify(out)); process.exit(0); };
socket.on("unexpected-response", (request, response) => { out.error = "status " + response.statusCode; done(); });
socket.on("error", (error) => { out.error = String(error.message); });
socket.on("open", () => {
  out.opened = true;
  for (const text of spec.send || []) socket.send(text);
});
socket.on("message", (data) => {
  out.messages.push(String(data));
  if (out.messages.length >= (spec.expect || 1)) { if (spec.closeAfter) socket.close(1000); else done(); }
});
socket.on("close", (code) => { out.closeCode = code; setTimeout(done, 150); });
setTimeout(done, spec.timeoutMs || 5000);
`;

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

interface SocketSpec {
  route: string;
  /** Overrides the default `ws://` URL of the session's first server. */
  url?: string;
  send?: string[];
  expect?: number;
  closeAfter?: boolean;
}

export async function talk(session: Session, label: string, spec: SocketSpec): Promise<{ folder: string; parsed: Json | undefined }> {
  const ran = await session.context.command(label, "node", ["-e", SCRIPT, JSON.stringify({ ...spec, url: spec.url ?? `ws://127.0.0.1:${session.port}${spec.route}` })], { cwd: session.context.repo });
  const parsed = parseJson(ran.stdout.trim().split("\n").pop() ?? "");
  if (parsed === undefined || parsed === null) session.context.notVerified(`the WebSocket client printed no result: ${ran.stderr.slice(0, 200)}`);
  if (pick(parsed, "opened") !== true) await session.recheck(session.port);
  return { folder: ran.folder, parsed };
}

export const websocketHandlers: Journey = {
  title: "a @WebsocketHandler upgrades the connection and hands it to @Connection with its route parameters, messages go both ways, a closed socket reaches the handler, and a path without a handler or a refusing prefix is not upgraded",
  entryPoint: "`@WebsocketHandler(location)` with `@Connection()`, reached with a WebSocket client",
  async run(context) {
    const session = await open(context, { controllers: WEBSOCKET_SOURCE });
    const echo = await talk(session, "echo over ws", { route: "/chat", send: ["hello", "second"], expect: 2, closeAfter: true });
    context.expect(echo.folder, [same("the handler echoes each message in order", echo.parsed, { opened: true, messages: ["Echo: hello", "Echo: second"], closeCode: 1000, error: null })]);
    const watched = await session.run("read what the monitor saw", "await waitFor(300); return controllers.monitored;");
    context.expect(watched.folder, [same("a monitor on a WebSocket route runs once the connection is upgraded, with the connection in its context", watched.value, ["monitor:true"])]);
    const boom = await talk(session, "a handler that throws after send", { route: "/chat/boom", expect: 1 });
    context.expect(boom.folder, [holds("the client receives what was sent before the failure", JSON.stringify(boom.parsed).includes("before the failure"), JSON.stringify(boom.parsed))]);
    const lateBoom = await talk(session, "an async handler that throws after send", { route: "/chat/late-boom", expect: 1 });
    context.expect(lateBoom.folder, [holds("the client receives what was sent before the failure", JSON.stringify(lateBoom.parsed).includes("before the async failure"), JSON.stringify(lateBoom.parsed))]);
    const failures = await session.run("read the monitor log after the failures", "await waitFor(500); return controllers.monitored.filter((entry) => entry !== 'monitor:true');");
    context.expect(failures.folder, [same("a monitor sees the error a WebSocket handler threw after the upgrade, also an asynchronous one", failures.value, ["boom:Error: socket boom", "late-boom:Error: late socket boom"])]);
    const latePrivate = await talk(session, "ws behind an async prefix that refuses", { route: "/chat/late-private", expect: 1 });
    context.expect(latePrivate.folder, [holds("an async prefix that resolves a value stops the upgrade", !JSON.stringify(latePrivate.parsed).includes('"opened":true') && !JSON.stringify(latePrivate.parsed).includes("never reached"), JSON.stringify(latePrivate.parsed))]);
    const room = await talk(session, "join a room", { route: "/chat/rooms/lobby?token=t1", expect: 1, closeAfter: true });
    context.expect(room.folder, [same("route and query parameters reach the handler", room.parsed, { opened: true, messages: ["joined lobby as t1"], closeCode: 1000, error: null })]);
    const second = await talk(session, "join another room", { route: "/chat/rooms/other", expect: 1, closeAfter: true });
    context.expect(second.folder, [same("a second room is a second connection", second.parsed, { opened: true, messages: ["joined other as undefined"], closeCode: 1000, error: null })]);
    const property = await talk(session, "connection on a class property", { route: "/prop-socket", expect: 1, closeAfter: true });
    context.expect(property.folder, [same("@Connection on a property is filled for the connection", property.parsed, { opened: true, messages: ["hello from a property"], closeCode: 1000, error: null })]);
    const closed = await session.run("read the close log", "await waitFor(300); return controllers.closed;");
    context.expect(closed.folder, [same("every closed socket reached its handler", closed.value, ["chat", "room lobby", "room other"])]);
    const plain = await talk(session, "ws to an HTTP-only route", { route: "/chat/http-only", expect: 1 });
    context.expect(plain.folder, [holds("an HTTP route is not a WebSocket route", !JSON.stringify(plain.parsed).includes('"opened":true'), JSON.stringify(plain.parsed))]);
    for (const route of ["/chat", "/chat/rooms/lobby", "/prop-socket"]) {
      const get = await session.get(`GET ${route} without an Upgrade header`, route);
      context.expect(get.folder, [status(`a WebSocket route answers a plain GET with 404`, get, 404), bodyIs("Not Found", get, "Not Found")]);
    }
    const stillClosed = await session.run("read the close log after the plain GETs", "return controllers.closed;");
    context.expect(stillClosed.folder, [same("no WebSocket handler ran for a plain GET", stillClosed.value, ["chat", "room lobby", "room other"])]);
    const nothing = await talk(session, "ws to an unknown path", { route: "/nowhere", expect: 1 });
    context.expect(nothing.folder, [holds("a path without a handler is not upgraded", !JSON.stringify(nothing.parsed).includes('"opened":true'), JSON.stringify(nothing.parsed))]);
    const refused = await talk(session, "ws behind a prefix that refuses", { route: "/chat/private", expect: 1 });
    context.expect(refused.folder, [holds("a prefix that returns a value stops the upgrade", !JSON.stringify(refused.parsed).includes('"opened":true') && !JSON.stringify(refused.parsed).includes("never reached"), JSON.stringify(refused.parsed))]);
    await finish(session);
  },
};

export const secureWebsocket: Journey = {
  title: "an https server upgrades WebSocket connections like an http one: a wss:// client reaches the same @WebsocketHandler and gets its messages echoed",
  entryPoint: "`servers: [{ protocol: \"https\", cert, key }, { protocol: \"http\" }]` in the module's config, reached with `wss://` and `ws://` clients",
  async run(context) {
    const { cert, key } = await pem(context);
    const [tls, plain] = await pickPorts(context, 2);
    const session = await open(context, {
      controllers: WEBSOCKET_SOURCE,
      config: { servers: [{ protocol: "https", host: "127.0.0.1", port: tls, cert, key }, { protocol: "http", host: "127.0.0.1", port: plain }] },
    });
    const secure = await talk(session, "echo over wss", { route: "/chat", url: `wss://127.0.0.1:${String(tls)}/chat`, send: ["hello", "second"], expect: 2, closeAfter: true });
    context.expect(secure.folder, [same("the https server hands the connection to the handler, which echoes each message in order", secure.parsed, { opened: true, messages: ["Echo: hello", "Echo: second"], closeCode: 1000, error: null })]);
    const clear = await talk(session, "echo over ws on the http server", { route: "/chat", url: `ws://127.0.0.1:${String(plain)}/chat`, send: ["hello"], expect: 1, closeAfter: true });
    context.expect(clear.folder, [same("the http server does the same", clear.parsed, { opened: true, messages: ["Echo: hello"], closeCode: 1000, error: null })]);
    const room = await talk(session, "join a room over wss", { route: "/chat/rooms/lobby", url: `wss://127.0.0.1:${String(tls)}/chat/rooms/lobby?token=t9`, expect: 1, closeAfter: true });
    context.expect(room.folder, [same("route and query parameters reach the handler over wss", room.parsed, { opened: true, messages: ["joined lobby as t9"], closeCode: 1000, error: null })]);
    await finish(session);
  },
};
