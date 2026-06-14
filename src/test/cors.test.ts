import assert from "node:assert";
import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { GetCorsConfig, SetCorsConfig } from "../implementations/api";
import { configure, getConfig, setCorsConfig } from "../index";
import { Cors } from "../middlewares/cors";

const ALLOWED_ORIGIN = "https://example.com";
const DISALLOWED_ORIGIN = "https://evil.com";
const REQUESTED_HEADERS = "x-custom";
const PREFLIGHT_STATUS = 204;

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

describe("CORS", () => {
  let originalConfig: ReturnType<typeof getConfig>;

  before(() => {
    originalConfig = getConfig();
  });

  after(() => {
    configure(originalConfig);
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
