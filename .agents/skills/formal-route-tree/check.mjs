#!/usr/bin/env node
/**
 * Builds the module and runs `dist/test/formal-route-tree.test.js`, passing `--full`, `--runs <n>` and
 * `--seed <n>` on as `FORMAL_RUNS` and `FORMAL_SEED`. Prints nothing and exits 0 when the property
 * holds. Exits 1 and prints `BROKEN RouteTreeMatchesReference` with the failing seed and the smallest
 * scenario when it does not, and exits 2 when the check could not run. Needs port 5010 free, as `pnpm test` does.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ERROR = 2;
const FULL_RUNS = "2000";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const env = { ...process.env };

function value(/** @type {string} */ flag) {
  const at = args.indexOf(flag);
  const given = at === -1 ? undefined : args[at + 1];
  if (at !== -1 && !/^[1-9][0-9]*$/.test(given ?? "")) {
    console.error(`${flag} takes a positive integer`);
    process.exit(TOOL_ERROR);
  }
  return given;
}

if (args.includes("--full")) {
  env.FORMAL_RUNS = FULL_RUNS;
}
env.FORMAL_RUNS = value("--runs") ?? env.FORMAL_RUNS;
env.FORMAL_SEED = value("--seed") ?? env.FORMAL_SEED;

const build = spawnSync("pnpm", ["run", "--silent", "build"], { cwd: root, encoding: "utf8" });
if (build.status !== 0) {
  console.error(`${build.stdout}${build.stderr}`);
  process.exit(TOOL_ERROR);
}
const ajs = path.join(root, "node_modules", ".bin", "ajs");
const test = spawnSync(ajs, ["module", "test", ".", "-f", "dist/test/formal-route-tree.test.js"], {
  cwd: root,
  env,
  encoding: "utf8",
});
if (test.status === 0) {
  process.exit(0);
}
const output = `${test.stdout}${test.stderr}`;
if (/AssertionError/.test(output)) {
  console.log("BROKEN RouteTreeMatchesReference");
  console.log(output);
  process.exit(1);
}
console.error(output);
process.exit(TOOL_ERROR);
