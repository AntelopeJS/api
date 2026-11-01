import { interrupted, type Journey } from "@antelopejs/tooling-configs/verify";

import { holds, same } from "./checks.ts";
import { headerIs, header, status, type Reply } from "./client.ts";
import { open, type Session } from "./session.ts";
import { CORS_SOURCE } from "./sources-cors.ts";

const APP = "https://app.example.com";
const ADMIN = "https://admin.example.com";

async function finish(session: Session): Promise<void> {
  const stopped = await session.stop();
  session.context.expect(stopped.folder, [interrupted(stopped)]);
}

/** A browser's preflight for a request from `origin`. */
function preflight(session: Session, label: string, origin: string, extra: Record<string, string> = {}): Promise<Reply> {
  return session.get(`${label}: OPTIONS /ping from ${origin}`, "/ping", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", ...extra } });
}

function allows(label: string, reply: Reply, origin: string): ReturnType<typeof holds> {
  return holds(`${label}: the origin ${origin} is allowed`, header(reply, "access-control-allow-origin") === origin, `access-control-allow-origin ${String(header(reply, "access-control-allow-origin"))}`);
}

function refuses(label: string, reply: Reply, origin: string): ReturnType<typeof holds> {
  return holds(`${label}: the origin ${origin} is not allowed`, header(reply, "access-control-allow-origin") !== origin, `access-control-allow-origin ${String(header(reply, "access-control-allow-origin"))}`);
}

export const corsConfig: Journey = {
  title: "a configured CORS policy answers the preflight with its listed origins, methods, headers, credentials and max age, and allows loopback origins in development without listing them",
  entryPoint: "`cors` in the module's config in antelope.config.ts, called over HTTP with Origin headers",
  async run(context) {
    const cors = { allowedOrigins: [APP, ADMIN], allowedMethods: ["GET", "POST", "PUT", "DELETE"], allowedHeaders: ["content-type", "authorization"], credentials: true, maxAge: 600 };
    const session = await open(context, { controllers: CORS_SOURCE, config: { cors } });
    const first = await preflight(session, "a listed origin", APP, { "access-control-request-headers": "x-other" });
    context.expect(first.folder, [status("preflight", first, 204), allows("preflight", first, APP), headerIs("methods", first, "access-control-allow-methods", "GET,POST,PUT,DELETE"), headerIs("static headers win over the requested ones", first, "access-control-allow-headers", "content-type,authorization"), headerIs("credentials", first, "access-control-allow-credentials", "true"), headerIs("max age", first, "access-control-max-age", "600")]);
    const second = await preflight(session, "the second listed origin", ADMIN);
    context.expect(second.folder, [allows("second entry of the list", second, ADMIN)]);
    const stranger = await preflight(session, "an unlisted origin", "https://evil.example.net");
    context.expect(stranger.folder, [refuses("preflight", stranger, "https://evil.example.net")]);
    const lookalike = await preflight(session, "a look-alike of a listed origin", `${APP}.evil.net`);
    context.expect(lookalike.folder, [refuses("a longer origin is not a prefix match", lookalike, `${APP}.evil.net`)]);
    const otherScheme = await preflight(session, "a listed host over http", "http://app.example.com");
    context.expect(otherScheme.folder, [refuses("the scheme is part of the origin", otherScheme, "http://app.example.com")]);
    for (const loopback of ["http://localhost:5173", "http://127.0.0.1:3000", "http://[::1]:8081", "https://localhost"]) {
      const reply = await preflight(session, "a loopback origin in development", loopback);
      context.expect(reply.folder, [allows("development", reply, loopback)]);
    }
    for (const outside of ["http://localhost.evil.net:3000", "ftp://localhost:21", "http://10.0.0.5:3000"]) {
      const reply = await preflight(session, "an origin that only looks like loopback", outside);
      context.expect(reply.folder, [refuses("development", reply, outside)]);
    }
    const plain = await session.get("GET /ping from a listed origin", "/ping", { headers: { origin: APP } });
    context.expect(plain.folder, [status("an ordinary request", plain, 200), same("body", plain.json, { ok: true }), allows("ordinary request", plain, APP), headerIs("credentials", plain, "access-control-allow-credentials", "true")]);
    const rejected = await session.get("GET /ping from an unlisted origin", "/ping", { headers: { origin: "https://evil.example.net" } });
    context.expect(rejected.folder, [refuses("an ordinary request", rejected, "https://evil.example.net")]);
    await finish(session);
  },
};

export const corsDefaults: Journey = {
  title: "with only allowedOrigins set, the preflight allows GET,HEAD,PUT,PATCH,POST,DELETE, credentials, and reflects the requested headers with no max age",
  entryPoint: "`cors: { allowedOrigins: \"https://app.example.com\" }` in the module's config, called over HTTP",
  async run(context) {
    const session = await open(context, { controllers: CORS_SOURCE, config: { cors: { allowedOrigins: APP } } });
    const reply = await preflight(session, "a single string origin", APP, { "access-control-request-headers": "x-custom, content-type" });
    context.expect(reply.folder, [allows("a string rather than a list", reply, APP), headerIs("default methods", reply, "access-control-allow-methods", "GET,HEAD,PUT,PATCH,POST,DELETE"), headerIs("credentials default to true", reply, "access-control-allow-credentials", "true"), headerIs("requested headers are reflected", reply, "access-control-allow-headers", "x-custom, content-type"), headerIs("no max age unless set", reply, "access-control-max-age", undefined)]);
    const other = await preflight(session, "another origin", ADMIN);
    context.expect(other.folder, [refuses("only the one origin", other, ADMIN)]);
    const loopback = await preflight(session, "a loopback origin", "http://localhost:4200");
    context.expect(loopback.folder, [allows("development", loopback, "http://localhost:4200")]);
    await finish(session);
  },
};

export const corsRuntime: Journey = {
  title: "SetCorsConfig replaces the policy for later requests without a restart, accepts a RegExp and a mixed list, credentials false drops the header, and GetCorsConfig returns what was set",
  entryPoint: "`SetCorsConfig(config)` and `GetCorsConfig()` called from a module while the project runs",
  async run(context) {
    const session = await open(context, { controllers: CORS_SOURCE, config: { cors: { allowedOrigins: APP, maxAge: 100 } } });
    const before = await preflight(session, "the configured origin", APP);
    context.expect(before.folder, [allows("before the change", before, APP), headerIs("max age", before, "access-control-max-age", "100")]);
    const set = await session.run("replace the policy with a RegExp and a string", `await api.SetCorsConfig({ allowedOrigins: [/^https:\\/\\/preview-\\d+\\.example\\.com$/, "${ADMIN}"], allowedMethods: ["GET", "POST"], allowedHeaders: ["Content-Type", "x-antelopejs-auth"], credentials: true, maxAge: 600 }); return null;`);
    context.expect(set.folder, [holds("the scenario ran", set.ok, JSON.stringify(set.error))]);
    const dropped = await preflight(session, "the origin the old policy allowed", APP);
    context.expect(dropped.folder, [refuses("the new policy replaces the old one", dropped, APP), headerIs("the old max age is gone", dropped, "access-control-max-age", "600")]);
    const preview = await preflight(session, "an origin the RegExp matches", "https://preview-42.example.com");
    context.expect(preview.folder, [allows("RegExp", preview, "https://preview-42.example.com"), headerIs("methods", preview, "access-control-allow-methods", "GET,POST"), headerIs("headers", preview, "access-control-allow-headers", "Content-Type,x-antelopejs-auth")]);
    const nonMatching = await preflight(session, "an origin the RegExp does not match", "https://preview-x.example.com");
    context.expect(nonMatching.folder, [refuses("RegExp", nonMatching, "https://preview-x.example.com")]);
    const listed = await preflight(session, "the string beside the RegExp", ADMIN);
    context.expect(listed.folder, [allows("mixed list", listed, ADMIN)]);
    const current = await session.run("read the policy back", "const c = await api.GetCorsConfig(); return { origins: c.allowedOrigins.map(String), methods: c.allowedMethods, headers: c.allowedHeaders, credentials: c.credentials, maxAge: c.maxAge };");
    context.expect(current.folder, [same("GetCorsConfig returns what SetCorsConfig stored", current.value, { origins: ["/^https:\\/\\/preview-\\d+\\.example\\.com$/", ADMIN], methods: ["GET", "POST"], headers: ["Content-Type", "x-antelopejs-auth"], credentials: true, maxAge: 600 })]);
    const merged = await session.run("change one field and keep the rest", "const c = await api.GetCorsConfig(); await api.SetCorsConfig({ ...c, maxAge: 300, credentials: false }); const n = await api.GetCorsConfig(); return { maxAge: n.maxAge, credentials: n.credentials, methods: n.allowedMethods };");
    context.expect(merged.folder, [same("the spread keeps the other settings", merged.value, { maxAge: 300, credentials: false, methods: ["GET", "POST"] })]);
    const after = await preflight(session, "the same origin after the change", ADMIN);
    context.expect(after.folder, [allows("still allowed", after, ADMIN), headerIs("max age", after, "access-control-max-age", "300"), headerIs("credentials false sends no header", after, "access-control-allow-credentials", undefined), headerIs("methods kept", after, "access-control-allow-methods", "GET,POST")]);
    const zero = await session.run("set a policy with a max age of zero", `await api.SetCorsConfig({ allowedOrigins: "${ADMIN}", maxAge: 0 }); return null;`);
    context.expect(zero.folder, [holds("the scenario ran", zero.ok, JSON.stringify(zero.error))]);
    const nocache = await preflight(session, "a policy with maxAge 0", ADMIN);
    context.expect(nocache.folder, [allows("the origin", nocache, ADMIN), headerIs("a max age of 0 is sent, not left out", nocache, "access-control-max-age", "0")]);
    const omitted = await session.run("set a policy without allowedOrigins", "await api.SetCorsConfig({ maxAge: 5 }); return await api.GetCorsConfig();");
    context.expect(omitted.folder, [same("the policy is the one set", omitted.value, { maxAge: 5 })]);
    const closed = await preflight(session, "an origin when allowedOrigins is omitted", ADMIN);
    context.expect(closed.folder, [refuses("omitting allowedOrigins disables CORS", closed, ADMIN)]);
    await finish(session);
  },
};
