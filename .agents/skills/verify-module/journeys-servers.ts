import { createServer } from "node:net";
import { interrupted, type Journey, type JourneyContext } from "@antelopejs/tooling-configs/verify";

import { holds, matches, same } from "./checks.ts";
import { parseJson, pick } from "./json.ts";
import { status } from "./client.ts";
import { attempt, numberAt, open, path, pickPorts, type Session } from "./session.ts";
import { CORS_SOURCE } from "./sources-cors.ts";

const VARIABLES = { apiPort: "${@api.API_PORT}", local: "${@api.API_LOCAL_BASE_URL}", publicUrl: "${@api.API_PUBLIC_BASE_URL}" };
const READ_VARIABLES = "return config;";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

/** Holds a port busy, as another program of the developer's machine would. */
async function occupy(context: JourneyContext, port: number): Promise<{ close(): Promise<void> }> {
  const server = createServer();
  const listening = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
  if (!listening) context.notVerified(`the port ${String(port)} the journey meant to hold busy was taken`);
  return { close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function pem(context: JourneyContext): Promise<{ cert: string; key: string }> {
  const made = await context.command("make a self-signed certificate", "bash", ["-c", 'openssl req -x509 -newkey rsa:2048 -nodes -keyout "$PWD/key.pem" -out "$PWD/cert.pem" -subj /CN=localhost -days 1 >/dev/null 2>&1 && cat cert.pem && echo @@@ && cat key.pem'], { cwd: context.work });
  const [cert = "", key = ""] = made.stdout.split("@@@\n");
  if (!cert.includes("BEGIN CERTIFICATE") || !key.includes("PRIVATE KEY")) context.notVerified(`openssl made no certificate: ${made.stderr.slice(0, 200)}`);
  return { cert, key };
}

export const serverPorts: Journey = {
  title: "several servers serve the same routes, port 0 binds a free port, API_PORT, API_LOCAL_BASE_URL and API_PUBLIC_BASE_URL describe the first server as it really bound, and publicBaseUrl loses its trailing slashes",
  entryPoint: "`servers`, `publicBaseUrl` in the module's config and `${@api.API_PORT}` in another module's config",
  async run(context) {
    const [first, second] = await pickPorts(context, 2);
    const two = await open(context, {
      controllers: CORS_SOURCE,
      config: { servers: [{ protocol: "http", host: "127.0.0.1", port: first }, { protocol: "http", host: "127.0.0.1", port: second }], publicBaseUrl: "https://api.example.com///" },
      appConfig: VARIABLES,
    });
    for (const port of [first, second]) {
      const reply = await two.fetch(`GET :${String(port)}/ping`, `http://127.0.0.1:${String(port)}/ping`);
      context.expect(reply.folder, [status(`server on ${String(port)}`, reply, 200), same(`server on ${String(port)} serves the routes`, reply.json, { ok: true })]);
    }
    const vars = await two.run("read the config variables", READ_VARIABLES);
    context.expect(vars.folder, [same("the variables describe the first server", vars.value, { apiPort: first, local: `http://127.0.0.1:${String(first)}`, publicUrl: "https://api.example.com" })]);
    await finish(two);

    const random = await open(context, { controllers: CORS_SOURCE, config: { servers: [{ protocol: "http", host: "127.0.0.1", port: 0 }] }, appConfig: VARIABLES });
    const bound = await random.run("read the variables of a random port", READ_VARIABLES);
    const apiPort = numberAt(bound.value, "apiPort");
    context.expect(bound.folder, [holds("API_PORT is the port the server really bound, not 0", apiPort > 0, JSON.stringify(bound.value))]);
    const served = await random.fetch("GET the random port", `http://127.0.0.1:${String(apiPort)}/ping`);
    context.expect(served.folder, [status("the server answers on API_PORT", served, 200), same("the variables hold in dev without publicBaseUrl", { equal: JSON.stringify(bound.value).includes(`"local":"http://127.0.0.1:${String(apiPort)}"`) && JSON.stringify(bound.value).includes(`"publicUrl":"http://127.0.0.1:${String(apiPort)}"`) }, { equal: true })]);
    await finish(random);
  },
};

const FALLBACK_PROBE = String.raw`V=$(curl -s -X POST -d 'return config;' "http://127.0.0.1:$APP_PORT/")
echo "vars=$V"
P=$(echo "$V" | sed -n 's/.*"apiPort":\([0-9]*\).*/\1/p')
echo "moved=$P"
wait_ping "$P"
echo "ping=$(curl -s "http://127.0.0.1:$P/ping")"`;

export const portFallback: Journey = {
  title: "in development a busy port falls back to a free one that API_PORT reports and the log names, and strictPort makes the boot fail instead",
  entryPoint: "`servers[].port` on a port another program holds, with and without `strictPort`",
  async run(context) {
    const [busy] = await pickPorts(context, 1);
    const blocker = await occupy(context, busy);
    try {
      const moved = await attempt(context, "dev", { controllers: CORS_SOURCE, config: { servers: [{ protocol: "http", host: "127.0.0.1", port: busy }] }, appConfig: VARIABLES }, FALLBACK_PROBE);
      const port = Number(/^moved=(\d+)$/m.exec(moved.stdout)?.[1]);
      context.expect(moved.folder, [
        holds("the project came up although its port is busy", moved.ready, moved.stdout.slice(0, 600)),
        holds("API_PORT is another port than the busy one", port > 0 && port !== busy, `moved ${String(port)}, busy ${String(busy)}`),
        matches("the routes are served on the port it moved to", moved.stdout, /^ping=\{"ok":true\}$/m),
        matches("the log names the port it left and the one it took", moved.stdout, new RegExp(`Port ${String(busy)} in use, listening on http://127\\.0\\.0\\.1:${String(port)} instead`)),
      ]);
      const strict = await attempt(context, "dev", { controllers: CORS_SOURCE, config: { strictPort: true, servers: [{ protocol: "http", host: "127.0.0.1", port: busy }] } });
      context.expect(strict.folder, [holds("strictPort ends the boot with a failure", strict.ended && strict.projectExit !== "0", `ended ${String(strict.ended)}, exit ${String(strict.projectExit)}`), matches("it says the port is in use", strict.stdout, /EADDRINUSE|address already in use|already in use/i)]);
    } finally {
      await blocker.close();
    }
  },
};

export const serverProtocols: Journey = {
  title: "an https server beside an http one serves the same routes with its own certificate, and the variables follow the first server's protocol",
  entryPoint: "`servers: [{ protocol: \"https\", cert, key }, { protocol: \"http\" }]` in the module's config",
  async run(context) {
    const { cert, key } = await pem(context);
    const [tls, plain] = await pickPorts(context, 2);
    const session = await open(context, {
      controllers: CORS_SOURCE,
      config: { servers: [{ protocol: "https", host: "127.0.0.1", port: tls, cert, key }, { protocol: "http", host: "127.0.0.1", port: plain }] },
      appConfig: VARIABLES,
    });
    const secure = await session.fetch("GET https", `https://127.0.0.1:${String(tls)}/ping`);
    context.expect(secure.folder, [status("the https server", secure, 200), same("serves the routes", secure.json, { ok: true })]);
    const clear = await session.fetch("GET http", `http://127.0.0.1:${String(plain)}/ping`);
    context.expect(clear.folder, [status("the http server", clear, 200), same("serves the same routes", clear.json, { ok: true })]);
    const wrongScheme = await session.fetch("GET http on the https port", `http://127.0.0.1:${String(tls)}/ping`);
    context.expect(wrongScheme.folder, [holds("the https port does not answer plain http", wrongScheme.status !== 200, `status ${String(wrongScheme.status)}, error ${String(wrongScheme.error)}`)]);
    const vars = await session.run("read the variables", READ_VARIABLES);
    context.expect(vars.folder, [same("the first server is https", vars.value, { apiPort: tls, local: `https://127.0.0.1:${String(tls)}`, publicUrl: `https://127.0.0.1:${String(tls)}` })]);
    await finish(session);
  },
};

export const serverOptions: Journey = {
  title: "every key of a server entry besides protocol, host and port is handed to the Node.js http or https server, so maxHeaderSize on one server refuses a request the other accepts",
  entryPoint: "`servers: [{ protocol: \"http\", maxHeaderSize }]` in the module's config",
  async run(context) {
    const [tight, loose] = await pickPorts(context, 2);
    const session = await open(context, {
      controllers: CORS_SOURCE,
      config: { servers: [{ protocol: "http", host: "127.0.0.1", port: tight, maxHeaderSize: 2048 }, { protocol: "http", host: "127.0.0.1", port: loose }] },
    });
    const big = { "x-padding": "p".repeat(4096) };
    const small = await session.fetch("GET a small request on the limited server", `http://127.0.0.1:${String(tight)}/ping`);
    context.expect(small.folder, [status("a small request on the limited server", small, 200)]);
    const refused = await session.fetch("GET 4 KiB of headers on the limited server", `http://127.0.0.1:${String(tight)}/ping`, { headers: big });
    context.expect(refused.folder, [status("the limit applies", refused, 431)]);
    const accepted = await session.fetch("GET 4 KiB of headers on the other server", `http://127.0.0.1:${String(loose)}/ping`, { headers: big });
    context.expect(accepted.folder, [status("the other server has no such limit", accepted, 200), same("and serves the routes", accepted.json, { ok: true })]);
    await finish(session);
  },
};

export const devRegistry: Journey = {
  title: "while the project runs in development the module records its servers in .antelope/dev.json with a connectable host, the protocol and the bound port, in the order of `servers`, and the file is gone after Ctrl+C",
  entryPoint: "`.antelope/dev.json` of the project, read by tools that discover the API without being given its port",
  async run(context) {
    const [first, second] = await pickPorts(context, 2);
    const { cert, key } = await pem(context);
    const session = await open(context, {
      controllers: CORS_SOURCE,
      config: { servers: [{ protocol: "http", host: "0.0.0.0", port: first }, { protocol: "https", host: "127.0.0.1", port: second, cert, key }] },
    });
    const registry = await context.command("read .antelope/dev.json", "cat", [path(session.app.project, ".antelope/dev.json")]);
    const servers = pick(parseJson(registry.stdout), "servers", "api", "endpoints");
    context.expect(registry.folder, [same("both servers, a wildcard host as loopback", servers, [{ protocol: "http", host: "127.0.0.1", port: first }, { protocol: "https", host: "127.0.0.1", port: second }])]);
    await finish(session);
    const gone = await context.command("look for .antelope/dev.json after the stop", "ls", [path(session.app.project, ".antelope")]);
    context.expect(gone.folder, [holds("the registry file is removed on shutdown", !gone.stdout.includes("dev.json"), gone.stdout)]);
  },
};

export const listenOnDemand: Journey = {
  title: "autoListen false creates the servers without serving them until a module calls Listen()",
  entryPoint: "`autoListen: false` in the module's config and `Listen()` from another module",
  async run(context) {
    const session = await open(context, { controllers: CORS_SOURCE, config: { autoListen: false } });
    const before = await session.get("GET /ping before Listen()", "/ping", { timeoutMs: 2500 });
    context.expect(before.folder, [holds("nothing is served before Listen()", before.status !== 200, `status ${String(before.status)}, error ${String(before.error)}`)]);
    const listened = await session.run("call Listen()", "await api.Listen(); return true;");
    context.expect(listened.folder, [same("Listen resolves", listened.value, true)]);
    const after = await session.get("GET /ping after Listen()", "/ping");
    context.expect(after.folder, [status("served after Listen()", after, 200), same("the routes", after.json, { ok: true })]);
    await finish(session);
  },
};

const PRODUCTION_PROBE = String.raw`wait_ping "$PORT"
curl -s -o /dev/null -D "$PWD/headers.txt" -H 'Origin: http://localhost:3000' "http://127.0.0.1:$PORT/ping"
echo "origin-header=$(grep -ic '^access-control-allow-origin' "$PWD/headers.txt")"
echo "vars=$(curl -s -X POST -d 'return config;' "http://127.0.0.1:$APP_PORT/")"`;

export const productionBoot: Journey = {
  title: "outside development the boot fails without publicBaseUrl, binds exactly the configured port, publishes publicBaseUrl without its trailing slash and does not let a loopback origin through CORS",
  entryPoint: "`ajs project build` and `ajs project start` with and without `publicBaseUrl`, on a free and on a busy port",
  async run(context) {
    const missing = await attempt(context, "start", { controllers: CORS_SOURCE });
    context.expect(missing.folder, [holds("no publicBaseUrl ends the boot with a failure", missing.ended && missing.projectExit !== "0", `ended ${String(missing.ended)}, exit ${String(missing.projectExit)}`), matches("it names the missing key", missing.stdout, /Missing required configuration key "publicBaseUrl"/)]);
    const running = await attempt(context, "start", { controllers: CORS_SOURCE, config: { publicBaseUrl: "https://api.example.com/" }, appConfig: VARIABLES }, PRODUCTION_PROBE);
    context.expect(running.folder, [holds("the project came up", running.ready, running.stdout.slice(0, 400)), matches("the routes are served", running.stdout, /started=200/), matches("CORS is off without a cors config", running.stdout, /origin-header=0/), matches("publicBaseUrl is published without its trailing slash", running.stdout, /"publicUrl":"https:\/\/api\.example\.com"/)]);
    const [busy] = await pickPorts(context, 1);
    const blocker = await occupy(context, busy);
    try {
      const exact = await attempt(context, "start", { controllers: CORS_SOURCE, config: { publicBaseUrl: "https://api.example.com", servers: [{ protocol: "http", host: "127.0.0.1", port: busy }] } });
      context.expect(exact.folder, [holds("a busy port is not worked around", exact.ended && exact.projectExit !== "0", `ended ${String(exact.ended)}, exit ${String(exact.projectExit)}`), matches("the boot says the port is in use", exact.stdout, /EADDRINUSE|address already in use|already in use/i)]);
    } finally {
      await blocker.close();
    }
  },
};
