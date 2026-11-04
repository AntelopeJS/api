import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { header, headerIs, status } from "./client.ts";
import { parseJson, pick } from "./json.ts";
import { pem } from "./journeys-servers.ts";
import { open, pickPorts, type Json, type Session } from "./session.ts";
import { CORS_SOURCE } from "./sources-cors.ts";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

const SOCKETS_SCRIPT = String.raw`const net = require("node:net");
const tls = require("node:tls");
const spec = JSON.parse(process.argv[1]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function raw(host, port, payload, ms) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    let data = "";
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; socket.destroy(); resolve(value); } };
    socket.on("error", (error) => done({ error: error.code }));
    socket.on("connect", () => { if (payload) socket.write(payload); });
    socket.on("data", (chunk) => { data += chunk.toString("latin1"); if (data.includes("\r\n")) done({ line: data.split("\r\n")[0], ms: Date.now() - started }); });
    socket.on("close", () => done({ closed: true, ms: Date.now() - started }));
    setTimeout(() => done({ silent: true }), ms);
  });
}
function idle(host, port, ms) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let answered = false;
    socket.on("error", (error) => resolve({ error: error.code }));
    socket.on("connect", () => socket.write("GET /ping HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n"));
    socket.on("data", () => { answered = true; });
    socket.on("close", () => resolve({ answered, closed: true }));
    setTimeout(() => { socket.destroy(); resolve({ answered, closed: false }); }, ms);
  });
}
function secure(port, version) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, maxVersion: version });
    socket.on("secureConnect", () => { const protocol = socket.getProtocol(); socket.destroy(); resolve({ protocol }); });
    socket.on("error", (error) => resolve({ error: error.code || error.message }));
    setTimeout(() => resolve({ silent: true }), 2000);
  });
}
const get = "GET /ping HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n";
(async () => {
  const out = {};
  out.plainOnLoopback = await raw("127.0.0.1", spec.plain, get, 2000);
  out.plainOnOtherLoopback = await raw("127.0.0.2", spec.plain, get, 2000);
  out.v6OnV6 = await raw("::1", spec.v6, get, 2000);
  out.v6OnV4 = await raw("127.0.0.1", spec.v6, get, 2000);
  out.slowHeaders = await raw("127.0.0.1", spec.tuned, "GET /ping HTTP/1.1\r\nHost: x\r\n", 3000);
  out.noHostDefault = await raw("127.0.0.1", spec.plain, "GET /ping HTTP/1.1\r\nConnection: close\r\n\r\n", 2000);
  out.noHostAllowed = await raw("127.0.0.1", spec.tuned, "GET /ping HTTP/1.1\r\nConnection: close\r\n\r\n", 2000);
  out.idleTuned = await idle("127.0.0.1", spec.tuned, 2500);
  out.idleDefault = await idle("127.0.0.1", spec.plain, 1500);
  out.tlsAny = await secure(spec.secure, undefined);
  out.tlsOld = await secure(spec.secure, "TLSv1.2");
  console.log(JSON.stringify(out));
})();`;

export const serverSockets: Journey = {
  title: "a server entry binds only its host, and the Node.js options on it apply: header and request timeouts answer 408, an idle keep-alive socket closes after keepAliveTimeout, requireHostHeader false accepts a request without Host, and an https entry honours minVersion",
  entryPoint: "`servers: [{ protocol, host, port, headersTimeout, requestTimeout, connectionsCheckingInterval, keepAliveTimeout, requireHostHeader, minVersion }]` in the module's config, reached with raw sockets",
  async run(context) {
    const { cert, key } = await pem(context);
    const [plain, v6, tuned, secure] = await pickPorts(context, 4);
    const session = await open(context, {
      controllers: CORS_SOURCE,
      config: {
        servers: [
          { protocol: "http", host: "127.0.0.1", port: plain },
          { protocol: "http", host: "::1", port: v6 },
          { protocol: "http", host: "127.0.0.1", port: tuned, headersTimeout: 300, requestTimeout: 500, connectionsCheckingInterval: 100, keepAliveTimeout: 200, requireHostHeader: false },
          { protocol: "https", host: "127.0.0.1", port: secure, cert, key, minVersion: "TLSv1.3" },
        ],
      },
    });
    const ran = await context.command("probe the four servers with raw sockets", "node", ["-e", SOCKETS_SCRIPT, JSON.stringify({ plain, v6, tuned, secure })], { cwd: context.repo, timeoutMs: 60_000 });
    const out = parseJson(ran.stdout.trim().split("\n").pop() ?? "");
    const line = (name: string): Json => pick(out, name, "line") ?? pick(out, name, "error") ?? pick(out, name, "protocol") ?? (pick(out, name, "closed") === true ? "closed" : pick(out, name, "silent") === true ? "silent" : pick(out, name) === undefined ? "none" : "?");
    context.expect(ran.folder, [
      same("a server bound to 127.0.0.1 answers on 127.0.0.1", line("plainOnLoopback"), "HTTP/1.1 200 OK"),
      same("and refuses a connection to 127.0.0.2: host is the bind address", line("plainOnOtherLoopback"), "ECONNREFUSED"),
      same("a server bound to ::1 answers on ::1", line("v6OnV6"), "HTTP/1.1 200 OK"),
      same("and refuses 127.0.0.1", line("v6OnV4"), "ECONNREFUSED"),
      same("unfinished headers on a server with headersTimeout 300 and requestTimeout 500 get a 408", line("slowHeaders"), "HTTP/1.1 408 Request Timeout"),
      same("a request without Host is refused by default (requireHostHeader)", line("noHostDefault"), "HTTP/1.1 400 Bad Request"),
      same("and served where requireHostHeader is false", line("noHostAllowed"), "HTTP/1.1 200 OK"),
      same("an idle keep-alive socket is closed after keepAliveTimeout 200", line("idleTuned"), "closed"),
      same("and stays open on a server with the default keepAliveTimeout", line("idleDefault"), "?"),
      same("an https entry with minVersion TLSv1.3 negotiates TLSv1.3", line("tlsAny"), "TLSv1.3"),
      same("and refuses a client limited to TLSv1.2", JSON.stringify(line("tlsOld")).startsWith("\"TLSv") ? "accepted" : "refused", "refused"),
    ]);
    await finish(session);
  },
};

const RELOAD_APP = "https://app.example.com";

export const serverReload: Journey = {
  title: "loading the api module again with a new configuration moves it to the new port and drops the cors policy the new configuration omits",
  entryPoint: "`StopModule`, `DestroyModule` and `LoadModule(\"api\", { source, config })` of `@antelopejs/interface-core/modules`, called from a module of the running project",
  async run(context) {
    const [first, second] = await pickPorts(context, 2);
    const session = await open(context, { controllers: CORS_SOURCE, config: { servers: [{ protocol: "http", host: "127.0.0.1", port: first }], cors: { allowedOrigins: RELOAD_APP } } });
    const before = await session.fetch("GET /ping on the first port with a listed origin", `http://127.0.0.1:${String(first)}/ping`, { headers: { origin: RELOAD_APP } });
    context.expect(before.folder, [status("the first port serves", before, 200), headerIs("with the CORS policy", before, "access-control-allow-origin", RELOAD_APP)]);
    const reloaded = await session.run("stop the api module and load it again with a new configuration", `const m = load("@antelopejs/interface-core/modules"); const declared = (await m.ListModuleDeclarations()).api; await m.StopModule("api"); await m.DestroyModule("api"); await m.LoadModule("api", { source: declared.source, config: { servers: [{ protocol: "http", host: "127.0.0.1", port: ${String(second)} }] } }, true); await waitFor(1500); return true;`);
    context.expect(reloaded.folder, [holds("the scenario ran", reloaded.ok, JSON.stringify(reloaded.error))]);
    const moved = await session.fetch("GET /ping on the new port with the old origin", `http://127.0.0.1:${String(second)}/ping`, { headers: { origin: RELOAD_APP } });
    context.expect(moved.folder, [status("the new port serves the routes", moved, 200), holds("and the origin the old cors policy listed is no longer allowed", header(moved, "access-control-allow-origin") !== RELOAD_APP, String(header(moved, "access-control-allow-origin")))]);
    const gone = await session.fetch("GET /ping on the old port", `http://127.0.0.1:${String(first)}/ping`, { timeoutMs: 2500 });
    context.expect(gone.folder, [holds("the old port no longer answers", gone.status !== 200, `status ${String(gone.status)}, error ${String(gone.error)}`)]);
    await finish(session);
  },
};
