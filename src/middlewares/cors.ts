import { Context, Controller, HTTPResult, HandlerPriority, Prefix, RequestContext } from '@ajs.local/api/beta';
import { getConfig } from '..';

function isString(s: any) {
  return typeof s === 'string' || s instanceof String;
}

function isOriginAllowed(origin: string, allowedOrigin?: string | RegExp | (string | RegExp)[]) {
  if (Array.isArray(allowedOrigin)) {
    for (let i = 0; i < allowedOrigin.length; ++i) {
      if (isOriginAllowed(origin, allowedOrigin[i])) {
        return true;
      }
    }
    return false;
  } else if (isString(allowedOrigin)) {
    return origin === allowedOrigin;
  } else if (allowedOrigin instanceof RegExp) {
    return allowedOrigin.test(origin);
  } else {
    return !!allowedOrigin;
  }
}

export class Cors extends Controller('') {
  @Prefix('any', '/', HandlerPriority.HIGHEST)
  cors(@Context() ctx: RequestContext) {
    const config = getConfig();

    if (!config.cors) {
      return;
    }

    const requestOrigin = ctx.rawRequest.headers.origin as string;
    const isAllowed = isOriginAllowed(requestOrigin, config.cors?.allowedOrigins);

    if (ctx.rawRequest.method === 'OPTIONS') {
      const response = new HTTPResult(204, null);

      response.addHeader('Access-Control-Allow-Origin', isAllowed ? requestOrigin : 'false');
      response.addHeader('Vary', 'Origin');
      response.addHeader(
        'Access-Control-Allow-Methods',
        config.cors?.allowedMethods ? config.cors?.allowedMethods.join(',') : 'GET,HEAD,PUT,PATCH,POST,DELETE',
      );
      response.addHeader('Access-Control-Allow-Credentials', 'true');
      response.addHeader(
        'Access-Control-Allow-Headers',
        ctx.rawRequest.headers['access-control-request-headers'] as string,
      );
      response.addHeader('Vary', 'Access-Control-Request-Headers');

      // Safari (and potentially other browsers) need content-length 0,
      // for 204 or they just hang waiting for a body
      response.addHeader('Content-Length', '0');

      return response;
    } else {
      ctx.response?.addHeader('Access-Control-Allow-Origin', isAllowed ? requestOrigin : 'false');
      ctx.response?.addHeader('Vary', 'Origin');
      ctx.response?.addHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
}
