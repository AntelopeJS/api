import { Context, Controller, HTTPResult, HandlerPriority, Prefix, RequestContext } from '@ajs.local/api/beta';
import { getConfig } from '..';

type AllowedOrigin = string | RegExp | Array<string | RegExp>;

type RequestHeaderValue = string | string[] | undefined;

const DEFAULT_ALLOWED_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE';
const FALSE_ORIGIN = 'false';
const TRUE_CREDENTIALS = 'true';
const NO_BODY_LENGTH = '0';

function isString(value: unknown): value is string {
  return typeof value === 'string' || value instanceof String;
}

function toHeaderValue(value: RequestHeaderValue): string {
  if (Array.isArray(value)) {
    return value.join(',');
  }

  return value ?? '';
}

function isOriginAllowed(origin: string, allowedOrigin?: AllowedOrigin): boolean {
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

function addPreflightHeaders(response: HTTPResult, requestContext: RequestContext, allowedOriginHeader: string): void {
  const config = getConfig();
  const allowedMethods = config.cors?.allowedMethods?.join(',') ?? DEFAULT_ALLOWED_METHODS;
  const requestedHeaders = toHeaderValue(requestContext.rawRequest.headers['access-control-request-headers']);

  response.addHeader('Access-Control-Allow-Origin', allowedOriginHeader);
  response.addHeader('Vary', 'Origin');
  response.addHeader('Access-Control-Allow-Methods', allowedMethods);
  response.addHeader('Access-Control-Allow-Credentials', TRUE_CREDENTIALS);
  response.addHeader('Access-Control-Allow-Headers', requestedHeaders);
  response.addHeader('Vary', 'Access-Control-Request-Headers');
  response.addHeader('Content-Length', NO_BODY_LENGTH);
}

function addStandardCorsHeaders(requestContext: RequestContext, allowedOriginHeader: string): void {
  requestContext.response.addHeader('Access-Control-Allow-Origin', allowedOriginHeader);
  requestContext.response.addHeader('Vary', 'Origin');
  requestContext.response.addHeader('Access-Control-Allow-Credentials', TRUE_CREDENTIALS);
}

export class Cors extends Controller('') {
  @Prefix('any', '/', HandlerPriority.HIGHEST)
  cors(@Context() requestContext: RequestContext): HTTPResult | undefined {
    const config = getConfig();

    if (!config.cors) {
      return undefined;
    }

    const requestOrigin = requestContext.rawRequest.headers.origin;
    const isAllowed = requestOrigin ? isOriginAllowed(requestOrigin, config.cors.allowedOrigins) : false;
    const allowedOriginHeader = isAllowed && requestOrigin ? requestOrigin : FALSE_ORIGIN;

    if (requestContext.rawRequest.method === 'OPTIONS') {
      const response = new HTTPResult(204, null);
      addPreflightHeaders(response, requestContext, allowedOriginHeader);
      return response;
    }

    addStandardCorsHeaders(requestContext, allowedOriginHeader);
    return undefined;
  }
}
