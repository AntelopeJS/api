import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { talk } from "./journeys-websocket.ts";
import { parseJson, pick } from "./json.ts";
import { open, type Json, type Session } from "./session.ts";
import { REFUSAL_SOURCE } from "./sources-ws-refusals.ts";

const SCRIPT = String.raw`const WebSocket = require("ws");
const spec = JSON.parse(process.argv[1]);
const out = { opened: false, status: null, body: null, connection: null, error: null, closeCode: null };
const socket = new WebSocket(spec.url);
let finished = false;
function done() {
  if (finished) return;
  finished = true;
  console.log(JSON.stringify(out));
  process.exit(0);
}
socket.on("unexpected-response", (request, response) => {
  out.status = response.statusCode;
  out.connection = response.headers.connection === undefined ? null : response.headers.connection;
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (data) => { body += data; });
  response.on("end", () => { out.body = body; setTimeout(done, 150); });
});
socket.on("error", (error) => { out.error = String(error.message); });
socket.on("open", () => { out.opened = true; socket.close(); });
socket.on("close", (code) => { out.closeCode = code; setTimeout(done, 150); });
setTimeout(done, 5000);
`;

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

interface Refusal {
  label: string;
  route: string;
  status: number;
  body: string;
}

async function refused(session: Session, refusal: Refusal): Promise<void> {
  const { label, route, status, body } = refusal;
  const ran = await session.context.command(`ws client at ${route}: ${label}`, "node", ["-e", SCRIPT, JSON.stringify({ url: `ws://127.0.0.1:${session.port}${route}` })], { cwd: session.context.repo });
  const parsed = parseJson(ran.stdout.trim().split("\n").pop() ?? "");
  if (parsed === undefined || parsed === null) session.context.notVerified(`the WebSocket client printed no result: ${ran.stderr.slice(0, 200)}`);
  if (pick(parsed, "status") === null) await session.recheck(session.port);
  session.context.expect(ran.folder, [
    same(`${label}: the client gets the HTTP answer, not a hung up socket`, parsed, { opened: false, status, body, connection: "close", error: null, closeCode: null }),
  ]);
}

export const websocketRefusals: Journey = {
  title: "a WebSocket client whose upgrade is refused gets the HTTP status and body of the refusal with Connection: close, never a hung up socket: a prefix that returns a value, one that throws, an asynchronous one that throws and a path without a handler; no refused handler runs and an accepted upgrade still works",
  entryPoint: "a `ws` client opening `@WebsocketHandler` routes behind `@Prefix` handlers that refuse, throw or are missing",
  async run(context) {
    const session = await open(context, { controllers: REFUSAL_SOURCE });
    await refused(session, { label: "a prefix returns a 403", route: "/refusal/private", status: 403, body: "private" });
    await refused(session, { label: "a prefix returns another status", route: "/refusal/teapot", status: 418, body: "short and stout" });
    await refused(session, { label: "a prefix throws", route: "/refusal/throwing", status: 500, body: "prefix exploded" });
    await refused(session, { label: "an asynchronous prefix throws", route: "/refusal/late-throwing", status: 500, body: "late prefix exploded" });
    await refused(session, { label: "no handler matches the path", route: "/refusal/nowhere", status: 404, body: "Not Found" });
    const reached = await session.run("read which refused handlers ran", "return controllers.reached;");
    context.expect(reached.folder, [same("no WebSocket handler behind a refusal ran", reached.value, [])]);
    const accepted: { folder: string; parsed: Json | undefined } = await talk(session, "an upgrade nothing refuses", { route: "/refusal/open", send: ["hello"], expect: 1, closeAfter: true });
    context.expect(accepted.folder, [holds("an upgrade nothing refuses is still accepted after the refusals", JSON.stringify(accepted.parsed).includes("Echo: hello"), JSON.stringify(accepted.parsed))]);
    await finish(session);
  },
};
