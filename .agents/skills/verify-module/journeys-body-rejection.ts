import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { bodyIs, status } from "./client.ts";
import { open, type Session } from "./session.ts";
import { REJECTION_SOURCE } from "./sources-body-rejection.ts";

const MIB = 1024 * 1024;
const OVER_THE_LIMIT = MIB + 1;
const ROUNDS = 6;

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

async function stillServed(session: Session, after: string): Promise<void> {
  const ping = await session.get(`GET /oversized/ping after ${after}`, "/oversized/ping");
  session.context.expect(ping.folder, [status(`the server still answers after ${after}`, ping, 200), same("with the route's body", ping.json, { ok: true })]);
}

export const bodyRejection: Journey = {
  title: "a body over 1 MiB read by @JSONBody never takes the server down when a later parameter throws or a rate limit answers: the client gets the later parameter's 500 or 429, the 413 of the body read stays internal, no handler runs and the next request is still served",
  entryPoint: "`@JSONBody()` followed by a throwing parameter provider, and `@RateLimit` under `@Post`, called over HTTP with bodies of 1 MiB + 1 byte",
  async run(context) {
    const session = await open(context, { controllers: REJECTION_SOURCE });
    for (let round = 1; round <= ROUNDS; round += 1) {
      const thrown = await session.get(`POST /oversized/throws #${String(round)}, ${String(OVER_THE_LIMIT)} bytes`, "/oversized/throws", { method: "POST", bodyBytes: OVER_THE_LIMIT, headers: { "content-type": "application/json" } });
      context.expect(thrown.folder, [status(`a later parameter throws #${String(round)}`, thrown, 500), bodyIs("the client gets the later parameter's message", thrown, "later parameter refused")]);
    }
    await stillServed(session, `${String(ROUNDS)} oversized bodies to a throwing parameter`);
    const throttled = await session.get("POST /oversized/throttled", "/oversized/throttled", { method: "POST", bodyBytes: OVER_THE_LIMIT });
    context.expect(throttled.folder, [status("a later parameter throws an HTTPResult", throttled, 429), bodyIs("its status and body reach the client", throttled, "slow down")]);
    await stillServed(session, "an oversized body to a parameter that answers 429");
    for (let call = 1; call <= ROUNDS; call += 1) {
      const reply = await session.get(`POST /oversized/limited #${String(call)}`, "/oversized/limited", { method: "POST", bodyBytes: OVER_THE_LIMIT });
      context.expect(reply.folder, [holds(`call ${String(call)} past the limit of 2 is 429 and within it is 413`, reply.status === (call <= 2 ? 413 : 429), `status ${String(reply.status)}, body ${reply.text.slice(0, 80)}`)]);
    }
    await stillServed(session, `${String(ROUNDS)} oversized bodies past a rate limit`);
    const ran = await session.run("read which handlers and parameters ran", "return controllers.ran;");
    context.expect(ran.folder, [same("no handler and no parameter after a throw ran for an oversized body", ran.value, [])]);
    await finish(session);
  },
};
