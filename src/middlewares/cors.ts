import {
  type AllowedOrigin,
  Context,
  Controller,
  type CorsConfig,
  HandlerPriority,
  HTTPResult,
  Prefix,
  type RequestContext,
} from "@antelopejs/interface-api";
import { getConfig } from "..";

type RequestHeaderValue = string | string[] | undefined;

const DEFAULT_ALLOWED_METHODS = "GET,HEAD,PUT,PATCH,POST,DELETE";
const FALSE_ORIGIN = "false";
const CREDENTIALS_ENABLED_VALUE = "true";
const NO_BODY_LENGTH = "0";
const DEFAULT_CREDENTIALS = true;

function isString(value: unknown): value is string {
  return typeof value === "string" || value instanceof String;
}

function toHeaderValue(value: RequestHeaderValue): string {
  if (Array.isArray(value)) {
    return value.join(",");
  }

  return value ?? "";
}

function isOriginAllowed(
  origin: string,
  allowedOrigin?: AllowedOrigin,
): boolean {
  if (Array.isArray(allowedOrigin)) {
    return allowedOrigin.some((item) => isOriginAllowed(origin, item));
  }

  if (isString(allowedOrigin)) {
    return origin === allowedOrigin;
  }

  if (allowedOrigin instanceof RegExp) {
    return allowedOrigin.test(origin);
  }

  return Boolean(allowedOrigin);
}

function isCredentialsEnabled(cors: CorsConfig): boolean {
  return cors.credentials ?? DEFAULT_CREDENTIALS;
}

function addCredentialsHeader(response: HTTPResult, cors: CorsConfig): void {
  if (isCredentialsEnabled(cors)) {
    response.addHeader(
      "Access-Control-Allow-Credentials",
      CREDENTIALS_ENABLED_VALUE,
    );
  }
}

function resolveAllowedHeaders(
  cors: CorsConfig,
  requestContext: RequestContext,
): string {
  if (cors.allowedHeaders && cors.allowedHeaders.length > 0) {
    return cors.allowedHeaders.join(",");
  }

  return toHeaderValue(
    requestContext.rawRequest.headers["access-control-request-headers"],
  );
}

function addPreflightHeaders(
  response: HTTPResult,
  requestContext: RequestContext,
  allowedOriginHeader: string,
  cors: CorsConfig,
): void {
  const allowedMethods =
    cors.allowedMethods?.join(",") ?? DEFAULT_ALLOWED_METHODS;

  response.addHeader("Access-Control-Allow-Origin", allowedOriginHeader);
  response.addHeader("Vary", "Origin");
  response.addHeader("Access-Control-Allow-Methods", allowedMethods);
  addCredentialsHeader(response, cors);
  response.addHeader(
    "Access-Control-Allow-Headers",
    resolveAllowedHeaders(cors, requestContext),
  );
  response.addHeader("Vary", "Access-Control-Request-Headers");

  if (cors.maxAge !== undefined) {
    response.addHeader("Access-Control-Max-Age", String(cors.maxAge));
  }

  response.addHeader("Content-Length", NO_BODY_LENGTH);
}

function addStandardCorsHeaders(
  requestContext: RequestContext,
  allowedOriginHeader: string,
  cors: CorsConfig,
): void {
  requestContext.response.addHeader(
    "Access-Control-Allow-Origin",
    allowedOriginHeader,
  );
  requestContext.response.addHeader("Vary", "Origin");
  addCredentialsHeader(requestContext.response, cors);
}

export class Cors extends Controller("") {
  @Prefix("any", "/", HandlerPriority.HIGHEST)
  cors(@Context() requestContext: RequestContext): HTTPResult | undefined {
    const cors = getConfig().cors;

    if (!cors) {
      return undefined;
    }

    const requestOrigin = requestContext.rawRequest.headers.origin;
    const isAllowed = requestOrigin
      ? isOriginAllowed(requestOrigin, cors.allowedOrigins)
      : false;
    const allowedOriginHeader =
      isAllowed && requestOrigin ? requestOrigin : FALSE_ORIGIN;

    if (requestContext.rawRequest.method === "OPTIONS") {
      const response = new HTTPResult(204, null);
      addPreflightHeaders(response, requestContext, allowedOriginHeader, cors);
      return response;
    }

    addStandardCorsHeaders(requestContext, allowedOriginHeader, cors);
    return undefined;
  }
}
