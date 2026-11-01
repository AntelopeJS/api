import type { App, JourneyContext, StopResult } from "@antelopejs/tooling-configs/verify";

import { APP_SOURCE } from "./app-source.ts";
import { holds, same } from "./checks.ts";
import { send, type Reply, type RequestSpec } from "./client.ts";
import { alive, killedOutside, ownPort, readinessOutage } from "./environment.ts";
import { isNumber, parseJson, pick, text, type Json } from "./json.ts";

export { numberAt, pick, type Json, type JsonRecord } from "./json.ts";
export type ModuleConfig = NonNullable<NonNullable<Parameters<JourneyContext["fixture"]>[0]>["moduleConfig"]>;

/** A path made of `parts`, joined the way the harness writes them. */
export function path(...parts: string[]): string {
  return parts.join("/");
}

/** How a journey wants its project set up. */
export interface Options {
  /** Keys merged over the module's config. The `servers` default is one HTTP server on a free loopback port. */
  config?: ModuleConfig;
  /** TypeScript source of the controllers the consumer module imports, compiled with the repository's `tsc`. */
  controllers?: string;
  /** Extra environment of `ajs project dev`. */
  env?: Record<string, string>;
  /** The consumer module's config, where `${@api.API_PORT}` and the other config variables can be used; the scenarios read it as `config`. */
  appConfig?: ModuleConfig;
  /** Milliseconds the consumer module's `start` waits, which holds the startup gate closed. */
  startDelayMs?: number;
  /** Milliseconds the consumer module's `stop` waits, which keeps the project in its stopping phase. */
  stopDelayMs?: number;
  /** A Node module the compiled controllers need, given as extra files of the consumer folder. */
  files?: Record<string, string>;
  /** Makes the consumer module's `start` throw. */
  startFails?: boolean;
  /** `dependencies` of the consumer module's package.json, the ranges core checks against the shared interface copies. */
  dependencies?: Record<string, string>;
  /** CommonJS source of a second module, `verify-extra`, loaded beside the consumer. */
  extra?: string;
}

const APP_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "esnext",
      module: "commonjs",
      moduleResolution: "node",
      strict: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ["node"],
      lib: ["ES2022"],
    },
    files: ["controllers.ts"],
  },
  null,
  2,
)}\n`;

/** Free loopback ports, taken together so they differ. */
export async function freePorts(context: JourneyContext, count: number): Promise<number[]> {
  const code = `const net = require("net"); const n = Number(process.argv[1]); const servers = []; let done = 0; const ports = [];
for (let i = 0; i < n; i++) { const s = net.createServer(); servers.push(s); s.listen(0, "127.0.0.1", () => { ports.push(s.address().port); if (++done === n) { console.log(JSON.stringify(ports)); servers.forEach((x) => x.close()); } }); }`;
  const picked = await context.command("pick free ports", "node", ["-e", code, String(count)]);
  const parsed = parseJson(picked.stdout.trim());
  const ports = Array.isArray(parsed) ? parsed.filter(isNumber) : [];
  if (ports.length !== count) context.notVerified(`no ${String(count)} free loopback ports: ${picked.stderr.slice(0, 200)}`);
  return ports;
}

/** What a scenario body answered: the value it returned or the error it threw. */
export interface Answer {
  folder: string;
  ok: boolean;
  value: Json | undefined;
  error: { name: string; message: string } | null;
}

export interface Session {
  context: JourneyContext;
  app: App;
  /** The first server of the module, `http://127.0.0.1:<port>`. */
  base: string;
  port: number;
  /** Sends a request to a path of the first server. */
  get(name: string, route: string, spec?: Omit<RequestSpec, "url">): Promise<Reply>;
  /** Sends a request to any URL. */
  fetch(name: string, url: string, spec?: Omit<RequestSpec, "url">): Promise<Reply>;
  /** Runs a scenario body inside the consumer module, with `api`, `util`, `load`, `waitFor` and the compiled `controllers` in scope. */
  run(name: string, body: string): Promise<Answer>;
  stop(): Promise<StopResult>;
  /** Re-probes the environment after a request to `port` failed: NOT VERIFIED when the project was killed from outside or another process holds the port. */
  recheck(port: number): Promise<void>;
}

function consumerFiles(context: JourneyContext, project: string, options: Options): void {
  context.edit("consumer package.json", path(project, "app", "package.json"), `${JSON.stringify({ name: "verify-app", version: "1.0.0", main: "index.js", antelopeJs: {}, dependencies: options.dependencies ?? {} }, null, 2)}\n`);
  context.edit("consumer source", path(project, "app", "index.js"), APP_SOURCE);
  for (const [file, content] of Object.entries(options.files ?? {})) context.edit(`consumer file ${file}`, path(project, "app", file), content);
  if (options.extra === undefined) return;
  context.edit("second module package.json", path(project, "extra", "package.json"), `${JSON.stringify({ name: "verify-extra", version: "1.0.0", main: "index.js", antelopeJs: {} }, null, 2)}\n`);
  context.edit("second module source", path(project, "extra", "index.js"), options.extra);
}

async function compile(context: JourneyContext, project: string, controllers: string): Promise<void> {
  context.edit("controllers source", path(project, "app", "controllers.ts"), controllers);
  context.edit("controllers tsconfig", path(project, "app", "tsconfig.json"), APP_TSCONFIG);
  const built = await context.command("compile the controllers", "node", [path(context.repo, "node_modules/typescript/bin/tsc"), "-p", path(project, "app")]);
  if (built.exitCode !== 0) context.notVerified(`the controllers did not compile with the repository's tsc: ${built.stdout.slice(0, 400)}`);
}

interface Prepared {
  project: string;
  apiPort: number;
  appPort: number;
  env: Record<string, string>;
}

/** Writes the project of a journey: the module under verification, the driver and the consumer module, with the controllers compiled. */
async function prepare(context: JourneyContext, options: Options, withDriver = true): Promise<Prepared> {
  const [apiPort, appPort] = await freePorts(context, 2);
  const servers = [{ protocol: "http", host: "127.0.0.1", port: apiPort }];
  const moduleConfig: ModuleConfig = { servers, ...options.config };
  const project = context.fixture({ moduleConfig });
  consumerFiles(context, project, options);
  const driver = withDriver ? { "verify-driver": { source: { type: "local", path: "./driver" } } } : {};
  const extra = options.extra === undefined ? {} : { "verify-extra": { source: { type: "local", path: "./extra" } } };
  const config = { name: "verify-api", modules: { api: { source: { type: "local", path: context.repo }, config: moduleConfig }, ...driver, "verify-app": { source: { type: "local", path: "./app" }, config: options.appConfig ?? {} }, ...extra } };
  context.edit("project config", path(project, "antelope.config.ts"), `export default ${JSON.stringify(config, null, 2)};\n`);
  const link = await context.command("link the repository's packages", "ln", ["-s", path(context.repo, "node_modules"), path(project, "app", "node_modules")]);
  context.expect(link.folder, [holds("the consumer resolves the repository's packages", link.exitCode === 0, link.stderr)], { critical: true });
  if (options.controllers !== undefined) await compile(context, project, options.controllers);
  const env = { VERIFY_APP_PORT: String(appPort), VERIFY_APP_START_DELAY: String(options.startDelayMs ?? 0), VERIFY_APP_STOP_DELAY: String(options.stopDelayMs ?? 0), VERIFY_APP_START_FAILS: options.startFails === true ? "1" : "", ...options.env };
  return { project, apiPort, appPort, env };
}

/** Starts `ajs project dev` with the module configured as the journey asks and a consumer module beside it. */
export async function open(context: JourneyContext, options: Options = {}): Promise<Session> {
  const { project, apiPort, appPort, env } = await prepare(context, options);
  const app = await context.dev("ajs project dev", project, { env }).catch(async (error: unknown) => {
    await readinessOutage(context, "ajs-project-dev");
    throw error;
  });
  const base = `http://127.0.0.1:${apiPort}`;
  let stopping = false;
  async function recheck(port: number): Promise<void> {
    if (stopping) return;
    if (!alive(app.pid)) {
      stopping = true;
      const ended = await context.stop("the project ended by itself", app);
      killedOutside(context, ended.signal);
      return;
    }
    await ownPort(context, port, app.pid);
  }
  async function checked(reply: Reply, port: number): Promise<Reply> {
    if (reply.status === null) await recheck(port);
    return reply;
  }
  return {
    context,
    app,
    base,
    port: apiPort,
    get: async (name, route, spec = {}) => checked(await send(context, name, { ...spec, url: `${base}${route}` }), apiPort),
    fetch: async (name, url, spec = {}) => checked(await send(context, name, { ...spec, url }), Number(new URL(url).port)),
    async run(name, body) {
      const result = await context.http(name, `http://127.0.0.1:${appPort}/`, { method: "POST", body });
      if (result.status === null) await recheck(appPort);
      const error = pick(result.json, "error");
      return {
        folder: result.folder,
        ok: pick(result.json, "ok") === true,
        value: pick(result.json, "value"),
        error: error === undefined ? null : { name: text(pick(error, "name")), message: text(pick(error, "message")) },
      };
    },
    async stop() {
      const gone = !stopping && !alive(app.pid);
      stopping = true;
      const stopped = await context.stop("SIGINT", app);
      if (gone) killedOutside(context, stopped.signal);
      return stopped;
    },
    recheck,
  };
}

const WATCH = String.raw`if [ "$MODE" = start ]; then
  node "$CLI" project build > "$OUT.build" 2>&1 || { echo "build-failed"; cat "$OUT.build"; exit 0; }
fi
wait_ping() {
  for i in $(seq 1 120); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$1/ping")
    [ "$code" != 503 ] && [ "$code" != 000 ] && break
    sleep 0.25
  done
  echo "started=$code"
}
node "$CLI" project "$MODE" > "$OUT" 2>&1 &
PID=$!
ready=0
for i in $(seq 1 120); do
  if curl -s --max-time 2 -X POST -d 'return true;' "http://127.0.0.1:$APP_PORT/" | grep -q '"ok":true'; then ready=1; break; fi
  kill -0 $PID 2>/dev/null || break
  sleep 0.25
done
echo "ready=$ready"
if [ "$ready" = 1 ] && [ "$PROBE" != ":" ]; then
  eval "$PROBE"
fi
if [ "$PROBE" = ":" ]; then
  for i in $(seq 1 40); do kill -0 $PID 2>/dev/null || break; sleep 0.25; done
fi
if kill -0 $PID 2>/dev/null; then echo "ended=0"; else echo "ended=1"; fi
kill -INT $PID 2>/dev/null
wait $PID 2>/dev/null
echo "exit=$?"
echo "--- output"
cat "$OUT"
`;

/** What `ajs project <mode>` printed and how it ended, with the probe's own output before it. */
export interface Attempt {
  folder: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** The `exit=` line of a watched run: how the project ended after the probe. */
  projectExit: string | undefined;
  /** Whether the consumer module answered before the project ended. */
  ready: boolean;
  /** Whether a project run without a probe ended by itself within ten seconds. */
  ended: boolean;
}

/**
 * Runs `ajs project <mode>` on the project. A project that must not come up ends on its own. Without a probe, the project is given ten seconds to end by itself. With a `probe`, a project whose consumer module answers runs the probe (a shell snippet using `$PORT`, `$APP_PORT` and `wait_ping <port>`, which waits until `/ping` stops answering 503), then is stopped with SIGINT.
 */
export async function attempt(context: JourneyContext, mode: "dev" | "start", options: Options = {}, probe = ":"): Promise<Attempt> {
  const { project, apiPort, appPort, env } = await prepare(context, options, false);
  const cli = path(context.repo, "node_modules/@antelopejs/core/dist/core/cli/index.js");
  const watchEnv = { ...env, CLI: cli, MODE: mode, OUT: path(project, "project.log"), PORT: String(apiPort), APP_PORT: String(appPort), PROBE: probe };
  const ran = await context.command(`ajs project ${mode}`, "bash", ["-c", WATCH], { cwd: project, env: watchEnv, timeoutMs: 90_000 });
  const exit = /^exit=(.*)$/m.exec(ran.stdout);
  const code = Number(exit?.[1]);
  if (code > 128 && code !== 130) context.notVerified(`the project was killed by signal ${String(code - 128)} from outside the journey: an environment outage, not a product failure`);
  if (!ran.stdout.includes("ready=1")) for (const port of [apiPort, appPort]) await ownPort(context, port, 0);
  return { folder: ran.folder, exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr, projectExit: exit?.[1], ready: ran.stdout.includes("ready=1"), ended: ran.stdout.includes("ended=1") };
}

/** The free port a journey passes in its config, so a journey can run a server beside another on a known port. */
export async function pickPorts(context: JourneyContext, count: number): Promise<number[]> {
  return freePorts(context, count);
}

/** A failing check when the scenario did not answer ok. */
export function ran(result: Answer): ReturnType<typeof holds> {
  return holds("the scenario ran", result.ok, JSON.stringify(result.error));
}

/** Compares what the consumer module saw with what the docs say it must be. */
export function sees(label: string, result: Answer, expected: Json): ReturnType<typeof same> {
  return same(label, result.value, expected);
}
