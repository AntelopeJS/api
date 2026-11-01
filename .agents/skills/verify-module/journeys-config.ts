import { type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { isString, parseJson, pick } from "./json.ts";

const VARIABLES_SCRIPT = String.raw`const { configVars } = require(process.cwd() + "/dist/config-vars.js");
const cases = JSON.parse(process.argv[1]);
const out = cases.map((config) => {
  try {
    return configVars(config);
  } catch (error) {
    return { error: String(error.message) };
  }
});
console.log(JSON.stringify(out));`;

const CASES = [
  { servers: [{ protocol: "http", host: "127.0.0.1", port: 8080 }] },
  { servers: [{ protocol: "http", host: "0.0.0.0", port: 9000 }] },
  { servers: [{ protocol: "http", host: "::", port: 9001 }] },
  { servers: [{ protocol: "http", host: "[::]", port: 9002 }] },
  { servers: [{ protocol: "http", port: 9003 }] },
  { servers: [{ protocol: "http", host: "127.0.0.1" }] },
  { servers: [{ protocol: "http", host: "api.internal", port: 9004 }] },
  { servers: [{ protocol: "http", host: "::1", port: 9005 }] },
  { servers: [{ protocol: "http", host: "[::1]", port: 9006 }] },
  { servers: [{ protocol: "https", host: "127.0.0.1", port: 8443 }], publicBaseUrl: "https://api.example.com///" },
  { servers: [{ protocol: "http", port: 9007 }], publicBaseUrl: "  https://api.example.com/  " },
  { servers: [{ protocol: "http", port: 9008 }], publicBaseUrl: "   " },
  { servers: [{ protocol: "http", port: 9009 }], publicBaseUrl: "" },
  { servers: [{ protocol: "http", host: "127.0.0.1", port: 9010 }, { protocol: "https", host: "other.example", port: 9011 }], publicBaseUrl: "https://first.example" },
  {},
  { servers: [] },
];

export const configVariables: Journey = {
  title: "the config variables file computes API_PORT, API_LOCAL_BASE_URL and API_PUBLIC_BASE_URL from the first server alone: wildcard hosts become loopback, explicit hosts stay, IPv6 is bracketed, publicBaseUrl loses its trailing slashes and falls back to the local origin",
  entryPoint: "`configVars` in `dist/config-vars.js`, named by `antelopeJs.configVarsFile`, read by tools that do not start the project",
  async run(context) {
    const ran = await context.command("compute the variables of sixteen configurations", "node", ["-e", VARIABLES_SCRIPT, JSON.stringify(CASES)], { cwd: context.repo });
    const out = parseJson(ran.stdout.trim());
    const row = (port: number, local: string, publicUrl: string) => ({ API_PORT: port, API_LOCAL_BASE_URL: local, API_PUBLIC_BASE_URL: publicUrl });
    const expected = [
      row(8080, "http://127.0.0.1:8080", "http://127.0.0.1:8080"),
      row(9000, "http://127.0.0.1:9000", "http://127.0.0.1:9000"),
      row(9001, "http://127.0.0.1:9001", "http://127.0.0.1:9001"),
      row(9002, "http://127.0.0.1:9002", "http://127.0.0.1:9002"),
      row(9003, "http://127.0.0.1:9003", "http://127.0.0.1:9003"),
      row(80, "http://127.0.0.1:80", "http://127.0.0.1:80"),
      row(9004, "http://api.internal:9004", "http://api.internal:9004"),
      row(9005, "http://[::1]:9005", "http://[::1]:9005"),
      row(9006, "http://[::1]:9006", "http://[::1]:9006"),
      row(8443, "https://127.0.0.1:8443", "https://api.example.com"),
      row(9007, "http://127.0.0.1:9007", "https://api.example.com"),
      row(9008, "http://127.0.0.1:9008", "http://127.0.0.1:9008"),
      row(9009, "http://127.0.0.1:9009", "http://127.0.0.1:9009"),
      row(9010, "http://127.0.0.1:9010", "https://first.example"),
    ];
    for (const [index, want] of expected.entries()) {
      context.expect(ran.folder, [same(`configuration ${String(index + 1)}`, pick(out, index), want)]);
    }
    for (const index of [14, 15]) {
      const message = pick(out, index, "error");
      context.expect(ran.folder, [holds(`configuration ${String(index + 1)} has no server and says so`, isString(message) && /no server is configured/.test(message), JSON.stringify(message))]);
    }
  },
};

export const manifest: Journey = {
  title: "package.json declares the interfaces the module implements, the config variables and their file, and the default configuration README.md describes: one HTTP server on localhost:8080",
  entryPoint: "`antelopeJs` in package.json, read by `ajs project modules add` and by tools that read the project without running it",
  async run(context) {
    const read = await context.command("read package.json", "cat", ["package.json"], { cwd: context.repo });
    const manifestJson = parseJson(read.stdout);
    const antelope = pick(manifestJson, "antelopeJs");
    context.expect(read.folder, [
      same("implements both interfaces", pick(antelope, "implements"), ["@antelopejs/interface-api", "@antelopejs/interface-api-util"]),
      same("publishes three config variables", pick(antelope, "configVars"), ["API_PORT", "API_LOCAL_BASE_URL", "API_PUBLIC_BASE_URL"]),
      same("names the file that computes them", pick(antelope, "configVarsFile"), "dist/config-vars.js"),
      same("the default configuration is one HTTP server on localhost:8080", pick(antelope, "defaultConfig"), { servers: [{ protocol: "http", host: "localhost", port: 8080 }] }),
    ]);
    context.expect(read.folder, [same("the entry point is dist/index.js", pick(manifestJson, "main"), "dist/index.js"), same("only dist is published", pick(manifestJson, "files"), ["dist"])]);
    const targets = await context.command("the files the manifest names exist", "ls", ["dist/config-vars.js", "dist/index.js"], { cwd: context.repo });
    context.expect(targets.folder, [holds("the built config variables file and the entry point exist", targets.exitCode === 0, targets.stderr)]);
  },
};
