import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { JourneyContext, StopResult } from "@antelopejs/tooling-configs/verify";

const OUTSIDE_SIGNALS = new Set(["SIGKILL", "SIGTERM", "SIGHUP", "SIGINT"]);
const CLEAN_EXITS = new Set([0, 130, 143]);
const CLEAN_STOP = "Stopped the project";

const HOLDERS = String.raw`ss -Htlnp "sport = :$PORT" | while read -r line; do
  pids=$(printf '%s' "$line" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  [ -z "$pids" ] && echo "unknown outside unseen"
  for h in $pids; do
    where=outside
    [ "$h" = "$SELF" ] && where=journey
    p=$h
    while [ "$where" = outside ] && [ -n "$p" ] && [ "$p" -gt 1 ]; do
      [ "$p" = "$PROJECT" ] && where=project
      p=$(ps -o ppid= -p "$p" | tr -d ' ')
    done
    echo "$h $where $(ps -o comm= -p "$h")"
  done
done`;

/** Whether a process is still running. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends the journey NOT VERIFIED when a process outside the project and outside the journey listens on `port`: a request that failed there met another program, not the module.
 */
export async function ownPort(context: JourneyContext, port: number, project: number): Promise<void> {
  const listed = await context.command(`re-probe who listens on ${String(port)}`, "bash", ["-c", HOLDERS], { env: { PORT: String(port), PROJECT: String(project), SELF: String(process.pid) } });
  const strangers = listed.stdout.split("\n").filter((line) => line.split(" ")[1] === "outside");
  if (strangers.length > 0) context.notVerified(`port ${String(port)} is held by a process outside the project (${strangers.join("; ")}): an environment outage, not a product failure`);
}

/**
 * Ends the journey NOT VERIFIED when the project ended before the journey's own stop and not by a failure of its own: killed by a signal the journey did not send, or stopped cleanly. `ajs` handles SIGTERM and SIGINT sent from outside, prints `Stopped the project` and exits 0 (or 130 or 143), as a supervisor stop, a CI timeout or a terminal Ctrl+C make it do. No product break stops a ready project cleanly on purpose, so a clean stop is an environment outage, never a catch.
 */
export function endedOutside(context: JourneyContext, ended: Pick<StopResult, "exitCode" | "signal" | "stdout">): void {
  if (ended.signal !== null && OUTSIDE_SIGNALS.has(ended.signal)) context.notVerified(`the project was killed by ${ended.signal} from outside the journey: an environment outage, not a product failure`);
  if ((ended.exitCode !== null && CLEAN_EXITS.has(ended.exitCode)) || ended.stdout.includes(CLEAN_STOP)) context.notVerified(`the project stopped cleanly (exit ${String(ended.exitCode)}) before the journey stopped it: a signal or stop from outside, an environment outage, not a product failure`);
}

/**
 * After `context.dev` failed its readiness probe, ends the journey NOT VERIFIED when another process holds the port the pack's driver had to bind. Reads the port and PID the pack recorded in the step folder of `step`.
 */
export async function readinessOutage(context: JourneyContext, step: string): Promise<void> {
  const evidence = join(dirname(dirname(dirname(context.work))), "evidence", basename(dirname(context.work)), basename(context.work));
  const folder = existsSync(evidence) ? readdirSync(evidence).filter((name) => name.endsWith(`-${step}`)).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)).pop() : undefined;
  if (folder === undefined) return;
  const [port, pid] = ["port.txt", "pid.txt"].map((file) => (existsSync(join(evidence, folder, file)) ? Number(readFileSync(join(evidence, folder, file), "utf8").trim()) : Number.NaN));
  if (Number.isInteger(port) && Number.isInteger(pid)) await ownPort(context, port, pid);
}
