import assert from "node:assert";
import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { isDevMode, setDevMode } from "../dev-mode";
import { GetCorsConfig, SetCorsConfig } from "../implementations/api";
import { configure, getConfig, setCorsConfig } from "../index";
import { Cors } from "../middlewares/cors";

const ALLOWED_ORIGIN = "https://example.com";
const DISALLOWED_ORIGIN = "https://evil.com";
const REQUESTED_HEADERS = "x-custom";
const PREFLIGHT_STATUS = 204;
const LOOPBACK_ORIGIN = "http://localhost:3000";
const LOOPBACK_IPV4_ORIGIN = "http://127.0.0.1:5173";
const LOOPBACK_IPV6_ORIGIN = "http://[::1]:4000";
const LOOPBACK_HTTPS_ORIGIN = "https://localhost:8443";
const LOOKALIKE_ORIGINS = [
  "http://localhost.evil.com:3000",
  "https://evil.com/?u=http://localhost:3000",
  "ftp://localhost:3000",
  "http://localhost:3000/",
  "http://localhost@evil.com",
  "localhost:3000",
  "not an origin",
  "",
];

interface RequestHeaders {
  origin?: string;
  "access-control-request-headers"?: string;
}

const corsController = new Cors();

function buildContext(method: string, headers: RequestHeaders): RequestContext {
  return {
    rawRequest: { method, headers },
    response: new HTTPResult(),
  } as unknown as RequestContext;
}

function preflightHeaders(headers: RequestHeaders): Record<string, string> {
  const result = corsController.cors(buildContext("OPTIONS", headers));
  assert.ok(result instanceof HTTPResult);
  return result.getHeaders();
}

function standardHeaders(headers: RequestHeaders): Record<string, string> {
  const context = buildContext("GET", headers);
  const result = corsController.cors(context);
  assert.equal(result, undefined);
  return context.response.getHeaders();
}

describe("CORS", () => {
  let originalConfig: ReturnType<typeof getConfig>;
  let originalDevMode: boolean;

  before(() => {
    originalConfig = getConfig();
    originalDevMode = isDevMode();
    setDevMode(false);
  });

  after(() => {
    configure(originalConfig);
    setDevMode(originalDevMode);
  });

  it("round-trips the configuration through the contract functions", () => {
    SetCorsConfig({ allowedOrigins: ALLOWED_ORIGIN, credentials: false });

    assert.deepEqual(GetCorsConfig(), {
      allowedOrigins: ALLOWED_ORIGIN,
      credentials: false,
    });
    assert.deepEqual(getConfig().cors, {
      allowedOrigins: ALLOWED_ORIGIN,
      credentials: false,
    });
  });

  it("returns an empty configuration when CORS is unset", () => {
    configure({ servers: [] });

    assert.deepEqual(GetCorsConfig(), {});
  });

  it("skips handling when no configuration is set", () => {
    configure({ servers: [] });

    const context = buildContext("GET", { origin: ALLOWED_ORIGIN });
    const result = corsController.cors(context);

    assert.equal(result, undefined);
    assert.deepEqual(context.response.getHeaders(), {});
  });

  it("adds standard headers for an allowed origin", () => {
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN });

    const context = buildContext("GET", { origin: ALLOWED_ORIGIN });
    const result = corsController.cors(context);
    const headers = context.response.getHeaders();

    assert.equal(result, undefined);
    assert.equal(headers["Access-Control-Allow-Origin"], ALLOWED_ORIGIN);
    assert.equal(headers["Access-Control-Allow-Credentials"], "true");
  });

  it("reports a disallowed origin as false", () => {
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN });

    const context = buildContext("GET", { origin: DISALLOWED_ORIGIN });
    corsController.cors(context);

    assert.equal(
      context.response.getHeaders()["Access-Control-Allow-Origin"],
      "false",
    );
  });

  it("omits the credentials header when credentials are disabled", () => {
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN, credentials: false });

    const context = buildContext("GET", { origin: ALLOWED_ORIGIN });
    corsController.cors(context);

    assert.equal(
      context.response.getHeaders()["Access-Control-Allow-Credentials"],
      undefined,
    );
  });

  it("emits preflight headers with configured methods and max-age", () => {
    setCorsConfig({
      allowedOrigins: ALLOWED_ORIGIN,
      allowedMethods: ["GET", "POST"],
      maxAge: 600,
    });

    const result = corsController.cors(
      buildContext("OPTIONS", { origin: ALLOWED_ORIGIN }),
    );

    assert.ok(result instanceof HTTPResult);
    assert.equal(result.getStatus(), PREFLIGHT_STATUS);
    const headers = result.getHeaders();
    assert.equal(headers["Access-Control-Allow-Methods"], "GET,POST");
    assert.equal(headers["Access-Control-Max-Age"], "600");
  });

  it("reflects the requested headers when none are configured", () => {
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN });

    const headers = preflightHeaders({
      origin: ALLOWED_ORIGIN,
      "access-control-request-headers": REQUESTED_HEADERS,
    });

    assert.equal(headers["Access-Control-Allow-Headers"], REQUESTED_HEADERS);
    assert.equal(headers.Vary, "Access-Control-Request-Headers");
  });

  it("uses the configured allowed headers over the requested ones", () => {
    setCorsConfig({
      allowedOrigins: ALLOWED_ORIGIN,
      allowedHeaders: ["X-A", "X-B"],
    });

    const headers = preflightHeaders({
      origin: ALLOWED_ORIGIN,
      "access-control-request-headers": REQUESTED_HEADERS,
    });

    assert.equal(headers["Access-Control-Allow-Headers"], "X-A,X-B");
    assert.equal(headers.Vary, "Origin");
  });

  it("omits the max-age header when it is not configured", () => {
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN });

    const headers = preflightHeaders({ origin: ALLOWED_ORIGIN });

    assert.equal(headers["Access-Control-Max-Age"], undefined);
  });
});

describe("CORS loopback origins", () => {
  let originalConfig: ReturnType<typeof getConfig>;
  let originalDevMode: boolean;

  before(() => {
    originalConfig = getConfig();
    originalDevMode = isDevMode();
  });

  after(() => {
    configure(originalConfig);
    setDevMode(originalDevMode);
  });

  beforeEach(() => {
    configure({ servers: [] });
    setDevMode(true);
  });

  it("reflects a loopback origin without any CORS configuration", () => {
    const headers = standardHeaders({ origin: LOOPBACK_ORIGIN });

    assert.equal(headers["Access-Control-Allow-Origin"], LOOPBACK_ORIGIN);
    assert.equal(headers["Access-Control-Allow-Credentials"], "true");
    assert.equal(headers.Vary, "Origin");
  });

  it("reflects a loopback origin on preflight without any CORS configuration", () => {
    const headers = preflightHeaders({
      origin: LOOPBACK_ORIGIN,
      "access-control-request-headers": REQUESTED_HEADERS,
    });

    assert.equal(headers["Access-Control-Allow-Origin"], LOOPBACK_ORIGIN);
    assert.equal(headers["Access-Control-Allow-Credentials"], "true");
    assert.equal(headers["Access-Control-Allow-Headers"], REQUESTED_HEADERS);
  });

  it("reflects every loopback host form", () => {
    const loopbackOrigins = [
      LOOPBACK_ORIGIN,
      LOOPBACK_IPV4_ORIGIN,
      LOOPBACK_IPV6_ORIGIN,
      LOOPBACK_HTTPS_ORIGIN,
    ];

    for (const origin of loopbackOrigins) {
      const headers = standardHeaders({ origin });
      assert.equal(headers["Access-Control-Allow-Origin"], origin);
    }
  });

  it("reflects a loopback origin alongside an unrelated allow list", () => {
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN });

    const headers = standardHeaders({ origin: LOOPBACK_ORIGIN });

    assert.equal(headers["Access-Control-Allow-Origin"], LOOPBACK_ORIGIN);
  });

  it("keeps honouring the configured origins", () => {
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN });

    const headers = standardHeaders({ origin: ALLOWED_ORIGIN });

    assert.equal(headers["Access-Control-Allow-Origin"], ALLOWED_ORIGIN);
  });

  it("rejects an unlisted non-loopback origin", () => {
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN });

    const headers = standardHeaders({ origin: DISALLOWED_ORIGIN });

    assert.equal(headers["Access-Control-Allow-Origin"], "false");
  });

  it("rejects origins that only look like loopback ones", () => {
    for (const origin of LOOKALIKE_ORIGINS) {
      const headers = standardHeaders({ origin });
      assert.equal(
        headers["Access-Control-Allow-Origin"],
        "false",
        `expected ${origin} to be rejected`,
      );
    }
  });

  it("skips handling outside of dev mode when no configuration is set", () => {
    setDevMode(false);

    const context = buildContext("GET", { origin: LOOPBACK_ORIGIN });
    const result = corsController.cors(context);

    assert.equal(result, undefined);
    assert.deepEqual(context.response.getHeaders(), {});
  });

  it("does not reflect a loopback origin outside of dev mode", () => {
    setDevMode(false);
    setCorsConfig({ allowedOrigins: ALLOWED_ORIGIN });

    const headers = standardHeaders({ origin: LOOPBACK_ORIGIN });

    assert.equal(headers["Access-Control-Allow-Origin"], "false");
  });
});
