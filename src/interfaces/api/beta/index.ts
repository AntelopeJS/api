import { RegisteringProxy, GetMetadata, InterfaceFunction } from '@ajs/core/beta';
import {
  Class,
  MakeMethodDecorator,
  MakeParameterAndPropertyDecorator,
  MakeParameterDecorator,
} from '@ajs/core/beta/decorators';
import { IncomingMessage, ServerResponse } from 'http';
import { PassThrough } from 'stream';
import Logging from '@ajs/logging/beta';

/**
 * @internal
 */
export namespace internal {
  export const routesProxy = new RegisteringProxy<(id: string, handler: RouteHandler) => void>();
}

export type ControllerClass<T = Record<string, any>> = Class<T> & {
  /**
   * Create a sub-controller at the given sub-location.
   *
   * Example:
   * ```ts
   * class MyController extends Controller("admin") {
   *     // This controller is at the /admin location
   * }
   *
   * class SubController extends MyController.extend("user") {
   *     // This controller is at the /admin/user location
   * }
   * ```
   *
   * @param location Sub-location
   * @returns Sub-controller
   */
  extend: <T extends ControllerClass>(this: T, location: string) => T;

  /**
   * Full location of this controller.
   */
  location: string;
};

/**
 * Result object of an API call.
 *
 * This object contains the status, body & content type, and additional headers.
 */
export class HTTPResult {
  private status = 200;
  private body = '';
  private contentType = 'text/plain';
  private stream?: PassThrough;
  /**
   * Additional response headers
   */
  private readonly headers: Record<string, string> = {};

  /**
   * Create a new HTTPResult from the given body or previous HTTPResult and the provided headers.
   *
   * @param res Body or HTTPResult - The content to be included in the response
   * @param headers Additional headers to apply to the response
   * @param defaultStatus Status code to use if creating a new HTTPResult (default: 200)
   * @returns New HTTPResult with the specified headers
   */
  public static withHeaders(res: any, headers: Record<string, string>, defaultStatus = 200) {
    const result = res instanceof HTTPResult ? res : new HTTPResult(defaultStatus, res);
    for (const [key, val] of Object.entries(headers)) {
      result.addHeader(key, val);
    }
    return result;
  }

  /**
   * @param status Status code
   * @param body Response body
   * @param type Content type
   */
  public constructor(status = 200, body?: unknown, type?: string) {
    this.setBody(body, type);
    this.setStatus(status);
  }

  /**
   * Set the response status.
   *
   * @param status HTTP status code (e.g., 200, 404, 500)
   */
  public setStatus(status: number) {
    this.status = status;
    if (status === 500) {
      console.error(this.body);
    }
  }

  /**
   * Get the response status.
   *
   * @returns Status code
   */
  public getStatus(): number {
    return this.status;
  }

  /**
   * Set the body of the response and its content type.
   *
   * @param body Body string or object
   * @param type Content type
   */
  public setBody(body: any, type?: string) {
    if (body === undefined || typeof body === 'string') {
      this.body = body || '';
      this.contentType = type ?? 'text/plain';
    } else {
      this.body = JSON.stringify(body);
      this.contentType = type ?? 'application/json';
    }
  }

  /**
   * Get the body of the response.
   *
   * @returns Body
   */
  public getBody(): any {
    return this.body;
  }

  /**
   * Get the content type of the response.
   *
   * @returns Content type
   */
  public getContentType(): string {
    return this.contentType;
  }

  /**
   * Add an additional header to the response.
   *
   * @param name Header name
   * @param value Header value
   */
  public addHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  /**
   * Remove an additional header from the response.
   *
   * @param name Header name
   */
  public removeHeader(name: string) {
    delete this.headers[name];
  }

  /**
   * Get the headers key-value store.
   *
   * @returns Headers object
   */
  public getHeaders(): Record<string, string> {
    return this.headers;
  }

  /**
   * Sets this response to be long-lived and gets its writable stream.
   * Use this for long-running responses like Server-Sent Events or streaming data.
   *
   * @param type Content type for the stream (default: 'text/plain')
   * @param status HTTP status code for the response (default: 200)
   * @returns Response write stream for sending data
   */
  public getWriteStream(type = 'text/plain', status = 200): PassThrough {
    if (!this.stream) {
      this.stream = new PassThrough();
    }
    this.contentType = type;
    this.status = status;
    this.body = '';
    return this.stream;
  }

  /**
   * Tests if this response is in stream mode.
   *
   * @returns Stream mode enabled
   */
  public isStream(): boolean {
    return !!this.stream;
  }

  /**
   * Send response without the body.
   *
   * @param res Response object
   */
  public sendHeadResponse(res: ServerResponse) {
    res.writeHead(this.status, { ...this.headers, 'Content-Type': this.contentType }).end();
    if (this.stream) {
      this.stream.end();
    }
  }

  /**
   * Send response.
   *
   * @param res Response object
   */
  public sendResponse(res: ServerResponse, abortStream = false) {
    res.writeHead(this.status, { ...this.headers, 'Content-Type': this.contentType });
    if (this.stream && !abortStream) {
      this.stream.pipe(res);
    } else {
      res.end(this.body);
    }
  }
}

/**
 * Handler priority enum.
 * Controls the execution order for handlers when multiple handlers match a route.
 * Lower values indicate higher priority and will execute first.
 */
export enum HandlerPriority {
  HIGHEST = 0, // Executes first
  HIGH = 1,
  NORMAL = 2, // Default priority
  LOW = 3,
  LOWEST = 4, // Executes last
}

/**
 * Request context.
 */
export interface RequestContext {
  /**
   * Raw HTTP request.
   */
  rawRequest: IncomingMessage;

  /**
   * Raw HTTP response.
   */
  rawResponse: ServerResponse;

  /**
   * Request URL.
   */
  url: URL;

  /**
   * Request parameters extracted from the URL.
   */
  routeParameters: Record<string, string>;

  /**
   * Raw request body.
   */
  body?: unknown;

  /**
   * HTTPResponse object that will be sent on completion.
   */
  response: HTTPResult;

  /**
   * Websocket connection.
   */
  connection?: unknown /* WebsocketConnection */;
}

/**
 * For computed parameters, the source of the parameter:
 *
 * Provider => [Modifier...] => Parameter/Property in handler
 *
 * @param context Request context
 * @returns Value passed to modifiers or directly to the handler
 */
export type ParameterProvider = (context: RequestContext) => unknown;

/**
 * For computed parameters, a modifier in the chain of the parameter:
 *
 * Provider => [Modifier...] => Parameter/Property in handler
 *
 * @param context Request context
 * @param previous Previous value in the chain (Return value of provider or previous modifier)
 * @returns Value passed to next modifier or handler
 */
export type ParameterModifier = (context: RequestContext, previous: unknown) => unknown;

/**
 * Combination of a parameter provider and zero or more parameter modifiers.
 */
export interface ComputedParameter {
  provider?: ParameterProvider;
  modifiers: ParameterModifier[];
}

/**
 * Runs a ComputedParameter with the given context.
 *
 * @param context Request context
 * @param param Computed parameter chain
 * @param obj this Object for provider/modifier calls
 * @returns Result
 */
export async function computeParameter(context: RequestContext, param: ComputedParameter | null, obj: unknown) {
  if (!param || !param.provider) {
    return undefined;
  }
  let val = await param.provider.apply(obj, [context]);
  for (const modifier of param.modifiers) {
    val = await modifier.apply(obj, [context, val]);
  }
  return val;
}

/**
 * Metadata Class containing the Controller information.
 */
export class ControllerMeta {
  /**
   * Key symbol
   */
  public static key = Symbol();

  /**
   * Full location or the controller
   */
  public readonly location: string;

  /**
   * Computed properties of the Controller (available to every handler)
   */
  public computed_props: Record<PropertyKey, ComputedParameter> = {};

  /**
   * Computed parameters (available only to its handler)
   */
  public computed_params: Record<PropertyKey, Record<number, ComputedParameter>> = {};

  constructor(target: { location: string }) {
    this.location = target.location;
  }

  inherit(parent: ControllerMeta) {
    this.computed_props = { ...parent.computed_props, ...this.computed_props };
    this.computed_params = { ...parent.computed_params, ...this.computed_params };
  }

  /**
   * Get the ComputedParameter on a given key
   *
   * @param key Handler key or Property key
   * @param param If used on a handler, parameter index
   * @returns ComputedParameter
   */
  getComputedParameter(key: PropertyKey, param: number | undefined) {
    if (param === undefined) {
      if (!(key in this.computed_props)) {
        this.computed_props[key] = { modifiers: [] };
      }
      return this.computed_props[key];
    } else {
      if (!(key in this.computed_params)) {
        this.computed_params[key] = [];
      }
      if (!(param in this.computed_params[key])) {
        this.computed_params[key][param] = { modifiers: [] };
      }
      return this.computed_params[key][param];
    }
  }

  /**
   * Sets the parameter provider of the ComputedParameter on the given key
   *
   * @param key Handler key or Property key
   * @param param If used on a handler, parameter index
   * @param modifier Parameter provider
   */
  setProvider(key: PropertyKey, param: number | undefined, provider: ParameterProvider) {
    this.getComputedParameter(key, param).provider = provider;
  }

  /**
   * Adds a parameter modifier to the ComputedParameter on the given key
   *
   * @param key Handler key or Property key
   * @param param If used on a handler, parameter index
   * @param modifier Parameter modifier
   */
  addModifier(key: PropertyKey, param: number | undefined, modifier: ParameterModifier) {
    this.getComputedParameter(key, param).modifiers.push(modifier);
  }

  /**
   * Get the list of ComputedParameter for a given handler
   *
   * @param key Handler key
   * @returns ComputedParameter list
   */
  getParameterArray(key: PropertyKey) {
    const paramsMap = this.computed_params[key] || {};
    const paramsMax = Object.keys(paramsMap)
      .map((val) => parseInt(val))
      .reduce((a, b) => Math.max(a, b), 0);
    const params = [];
    for (let i = 0; i <= paramsMax; ++i) {
      params[i] = i in paramsMap ? paramsMap[i] : null;
    }
    return params;
  }
}

/**
 * Create a new API Controller at the given root location.
 *
 * @param location Root location
 * @param base Optional base Controller to inherit properties from
 * @returns New Controller
 */
export function Controller<T extends object = object>(location: string, base?: Class<T>): ControllerClass<T> {
  const c: any = base ? class extends base {} : class {};

  c.location = location;
  c.extend = function (location: string) {
    return Controller(this.location + '/' + location, this as ControllerClass<T>);
  };

  return c as ControllerClass<T>;
}

/**
 * Gets the instance of a given Controller for the active request.
 *
 * @param cl Controller class
 * @param context Request context
 * @returns Controller instance
 */
export const GetControllerInstance: <T>(cl: Class<T>, context: RequestContext) => Promise<T> =
  InterfaceFunction<(cl: any, context: RequestContext) => any>();

/**
 * Handler mode.
 */
export type RouteHandlerMode = 'prefix' | 'postfix' | 'handler' | 'websocket';

/**
 * Route handler information.
 */
export interface RouteHandler {
  /**
   * Mode (prefix, handler, postfix, websocket).
   */
  mode: RouteHandlerMode;

  /**
   * HTTP method.
   */
  method: string;

  /**
   * Full location of the handler.
   */
  location: string;

  /**
   * Handler callback.
   *
   * @param args Handler parameters.
   * @returns Handler result.
   */
  callback: (...args: any[]) => any;

  /**
   * Computer handler parameters.
   */
  parameters: Array<ComputedParameter | null>;

  /**
   * Computed controller properties (reference).
   */
  properties: Record<string, ComputedParameter>;

  /**
   * Controller prototype.
   */
  proto: any;

  /**
   * Handler priority.
   */
  priority?: HandlerPriority;
}

/**
 * @internal
 */
export const routesProxy = new RegisteringProxy<(id: string, handler: RouteHandler) => void>();
const routesList: Array<RouteHandler & { id: number }> = [];
let nextId = 0;
/**
 * Register a RouteHandler to the API.
 *
 * @param handler Route handler
 * @returns New route ID
 */
export function RegisterRoute(handler: RouteHandler) {
  const id = nextId++;
  Logging.Debug(
    `Registered ${handler.method.toUpperCase()} ${handler.location} (${handler.callback.name || 'anonymous'})`,
  );
  routesProxy.register(id.toString(), handler);
  routesList.push({ ...handler, id });
  return id;
}

/**
 * Retrieves all registered routes with detailed information.
 * @returns {Array<Object>} An array of route information objects.
 */
export function getRegisteredRoutes(): Array<{
  id: string;
  location: string;
  method: string;
  callbackName: string;
  parameters: Array<ComputedParameter | null>;
  properties: Record<string, ComputedParameter>;
  priority?: HandlerPriority;
}> {
  return routesList.map((handler) => ({
    id: handler.id.toString(),
    location: handler.location,
    method: handler.method,
    callbackName: handler.callback.name || 'anonymous',
    parameters: handler.parameters,
    properties: handler.properties,
    priority: handler.priority,
  }));
}

/**
 * Register a RouteHandler to the API from a decorator.
 *
 * @param target Controller class
 * @param key Handler key
 * @param descriptor Handler descriptor
 * @param mode Handler mode (prefix, handler, postfix, websocket)
 * @param method HTTP method
 * @param location Endpoint location
 * @param priority Handler priority
 * @returns New route ID
 */
export function ProcessCallback(
  target: any,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  mode: RouteHandlerMode,
  method: string,
  location?: string,
  priority?: HandlerPriority,
) {
  const meta = GetMetadata(target.constructor as ControllerClass, ControllerMeta);
  const fullLocation = `${meta.location}/${location ?? (key as string)}`.replace(/\/+/g, '/');

  // Method decorator need an object as return value
  return {
    id: RegisterRoute({
      mode,
      method,
      location: fullLocation,
      callback: descriptor.value,
      parameters: meta.getParameterArray(key),
      properties: meta.computed_props,
      proto: target,
      priority,
    }),
  };
}

/**
 * Generic endpoint (route) decorator.
 *
 * @param mode Handler mode (prefix, handler, postfix, websocket)
 * @param method HTTP method
 * @param location Endpoint location
 * @param priority Handler priority
 */
export const Route = MakeMethodDecorator(ProcessCallback);

/**
 * DELETE endpoint (route) decorator.
 *
 * Creates a handler for HTTP DELETE requests at the specified location.
 * DELETE is used for removing resources and data.
 *
 * @param location Endpoint location relative to the controller path
 * @param mode Handler mode (prefix, handler, postfix, websocket) (default 'handler')
 *
 * Example:
 * ```ts
 * @Delete('users/:id')
 * async deleteUser(@Parameter('id') id: string) {
 *   const deleted = await deleteUserById(id);
 *   if (!deleted) {
 *     return new HTTPResult(404, { error: "User not found" });
 *   }
 *   return new HTTPResult(204);
 * }
 * ```
 */
export const Delete = MakeMethodDecorator(
  (target, key, descriptor, location?: string, mode: RouteHandlerMode = 'handler') => {
    ProcessCallback(target, key, descriptor, mode, 'delete', location);
  },
);

/**
 * GET endpoint (route) decorator.
 *
 * Creates a handler for HTTP GET requests at the specified location.
 * If no location is provided, the method name will be used as the endpoint path.
 *
 * @param location Endpoint location relative to the controller path (optional)
 * @param mode Handler mode - determines when the handler is executed (default: 'handler')
 *
 * Example:
 * ```ts
 * // Handles GET requests at /api/users
 * @Get('users)
 * getUsers() {
 *   return new HTTPResult(200, { users: [...] });
 * }
 * ```
 */
export const Get = MakeMethodDecorator(
  (target, key, descriptor, location?: string, mode: RouteHandlerMode = 'handler') => {
    ProcessCallback(target, key, descriptor, mode, 'get', location);
  },
);

/**
 * POST endpoint (route) decorator.
 *
 * Creates a handler for HTTP POST requests at the specified location.
 * POST is typically used for creating new resources or submitting data to be processed.
 *
 * @param location Endpoint location relative to the controller path
 * @param mode Handler mode (prefix, handler, postfix, websocket) (default 'handler')
 *
 * Example:
 * ```ts
 * @Post('users')
 * createUser(@JsonBody body: { name: string, email: string }) {
 *   const newUser = createUserInDatabase(body);
 *   return new HTTPResult(201, { id: newUser.id, ...body });
 * }
 * ```
 */
export const Post = MakeMethodDecorator(
  (target, key, descriptor, location?: string, mode: RouteHandlerMode = 'handler') => {
    ProcessCallback(target, key, descriptor, mode, 'post', location);
  },
);

/**
 * PUT endpoint (route) decorator.
 *
 * Creates a handler for HTTP PUT requests at the specified location.
 * PUT is typically used for updating existing resources where the client sends
 * the complete updated resource.
 *
 * @param location Endpoint location relative to the controller path
 * @param mode Handler mode (prefix, handler, postfix, websocket) (default 'handler')
 *
 * Example:
 * ```ts
 * @Put('products/:id')
 * updateProduct(
 *   @Parameter('id') id: string,
 *   @JsonBody product: { name: string, price: number }
 * ) {
 *   const updated = updateProductById(id, product);
 *   return new HTTPResult(200, updated);
 * }
 * ```
 */
export const Put = MakeMethodDecorator(
  (target, key, descriptor, location?: string, mode: RouteHandlerMode = 'handler') => {
    ProcessCallback(target, key, descriptor, mode, 'put', location);
  },
);

/**
 * Generic prefix route decorator.
 *
 * Attaches a handler that runs before the main handler for a specific route.
 * Prefix handlers are useful for authentication, input validation, request logging,
 * or other operations that should happen before the main handler is called.
 *
 * @param method HTTP method
 * @param location Endpoint location
 * @param priority Handler priority
 *
 * Example:
 * ```ts
 * @Prefix('*', '')
 * authenticateUser(@Parameter('Authorization', 'header') auth: string) {
 *   if (!auth || !auth.startsWith('Bearer ')) {
 *     return new HTTPResult(401, { error: 'Authentication required' });
 *   }
 *   // Authentication passed, continue to main handler
 * }
 * ```
 */
export const Prefix = MakeMethodDecorator(
  (target, key, descriptor, method: string, location?: string, priority?: HandlerPriority) => {
    ProcessCallback(target, key, descriptor, 'prefix', method, location, priority);
  },
);

/**
 * Generic postfix route decorator.
 *
 * Attaches a handler that runs after the main handler for a specific route.
 * Postfix handlers are useful for modifying responses, cleaning up resources,
 * or performing any operations that should happen after the main handler has completed.
 *
 * @param method HTTP method
 * @param location Endpoint location
 * @param priority Handler priority
 *
 * Example:
 * ```ts
 * @Postfix('get', '')
 * addHeaders(@Result response: HTTPResult) {
 *   response.addHeader('X-API-Version', '1.0');
 *   response.addHeader('X-Response-Time', getResponseTime());
 * }
 * ```
 */
export const Postfix = MakeMethodDecorator(
  (target, key, descriptor, method: string, location?: string, priority?: HandlerPriority) => {
    ProcessCallback(target, key, descriptor, 'postfix', method, location, priority);
  },
);

/**
 * Websocket endpoint (route) decorator.
 *
 * @param location Endpoint location
 *
 * Example:
 * ```ts
 * @WebsocketHandler('chat')
 * handleChat(@Connection conn: any) {
 *   conn.on('message', (msg) => {
 *     // Echo the message back
 *     conn.send(`Received: ${msg}`);
 *   });
 *
 *   conn.on('close', () => {
 *     console.log('Connection closed');
 *   });
 * }
 * ```
 */
export const WebsocketHandler = MakeMethodDecorator((target, key, descriptor, location?: string) => {
  ProcessCallback(target, key, descriptor, 'websocket', 'get', location);
});

/**
 * Get the body from a RequestContext object.
 *
 * @param context Request context
 * @returns Body buffer
 */
export function ReadBody(context: RequestContext) {
  if (context.body === undefined) {
    context.body = new Promise((resolve, reject) => {
      const buffers: Buffer[] = [];
      context.rawRequest.on('readable', () => {
        let chunk: Buffer | null;
        while ((chunk = context.rawRequest.read() as Buffer)) {
          buffers.push(chunk);
        }
      });

      context.rawRequest.on('end', () => {
        resolve(Buffer.concat(buffers));
      });

      context.rawRequest.on('error', reject);
    });
  }
  return context.body;
}

/**
 * Set the ParameterProvider on a Handler or Property.
 *
 * @param target Controller class
 * @param key Handler key or Property key
 * @param index If used on a handler, parameter index
 * @param provider ParameterProvider
 *
 * Example:
 * ```ts
 * // Custom user token extractor
 * function getUser(context: RequestContext): User | null {
 *   const token = context.rawRequest.headers.authorization?.split(' ')[1];
 *   return token ? verifyUserToken(token) : null;
 * }
 *
 * // Custom decorator that uses this provider
 * const CurrentUser = MakeParameterDecorator((target, key, param) =>
 *   SetParameterProvider(target, key, param, getUser)
 * );
 * ```
 */
export function SetParameterProvider(
  target: any,
  key: PropertyKey,
  index: number | undefined,
  provider: ParameterProvider,
) {
  GetMetadata(target.constructor as ControllerClass, ControllerMeta).setProvider(key, index, provider);
}

/**
 * Add a ParameterModifier on a Handler or Property.
 *
 * @param target Controller class
 * @param key Handler key or Property key
 * @param index If used on a handler, parameter index
 * @param transformer ParameterModifier
 *
 * Example:
 * ```ts
 * // Convert string ID to number
 * function toNumber(context: RequestContext, val: unknown): number {
 *   return parseInt(val as string, 10);
 * }
 *
 * // Create a decorator that adds this modifier
 * const AsNumber = MakeParameterDecorator((target, key, param) =>
 *   AddParameterModifier(target, key, param, toNumber)
 * );
 * ```
 */
export function AddParameterModifier(
  target: any,
  key: PropertyKey,
  index: number | undefined,
  transformer: ParameterModifier,
) {
  GetMetadata(target.constructor as ControllerClass, ControllerMeta).addModifier(key, index, transformer);
}

/**
 * Parameter Provider: Request Body.
 *
 * Provides access to the raw HTTP request body as a Buffer.
 * This is useful for processing raw data from the client, such as file uploads
 * or custom data formats.
 *
 * Example:
 * ```ts
 * @Post()
 * async uploadFile(@RawBody body: Buffer) {
 *   // Process the raw request body
 *   return new HTTPResult(200, { success: true });
 * }
 * ```
 */
export const RawBody = MakeParameterAndPropertyDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, ReadBody),
);

/**
 * Parameter Provider: Request Parameter.
 *
 * Extracts a single parameter value from the request. This can be from:
 * - Route parameters (from the URL path)
 * - Query parameters (from the URL query string)
 * - HTTP headers
 *
 * This provider will always return at most one value. For parameters that might
 * have multiple values (e.g., query parameters like ?tag=a&tag=b), use {@link MultiParameter}.
 *
 * @param name Name of the parameter to extract
 * @param source Where to extract the parameter from:
 *   - 'param': Route parameters (e.g., '/users/:id' where 'id' is the parameter)
 *   - 'query': URL query parameters (e.g., '/users?id=123' where 'id' is the parameter)
 *   - 'header': HTTP request headers (e.g., 'Authorization' or 'Content-Type')
 *
 * Example:
 * ```ts
 * @Get('users/:id')
 * getUser(
 *   @Parameter('id') id: string,
 *   @Parameter('fields', 'query') fields?: string,
 *   @Parameter('Authorization', 'header') auth?: string
 * ) {
 *   // id: from route parameter (/users/123)
 *   // fields: from query parameter (?fields=name,email)
 *   // auth: from the Authorization header
 *   return new HTTPResult(200, { id });
 * }
 * ```
 */
export const Parameter = MakeParameterAndPropertyDecorator(
  (target, key, param, name: string, source: 'param' | 'query' | 'header' = 'param') => {
    SetParameterProvider(target, key, param, (context) => {
      switch (source) {
        case 'param':
          return context.routeParameters[name];
        case 'query': {
          const val = context.url.searchParams.get(name);
          return val === null ? undefined : val || true;
        }
        case 'header': {
          const val2 = context.rawRequest.headers[name.toLowerCase()];
          return Array.isArray(val2) ? val2[0] : val2;
        }
      }
    });
  },
);

/**
 * Parameter Provider: Request Context.
 *
 * Provides access to the complete request context, which includes the raw request,
 * response, URL, route parameters, and other request-related information.
 *
 * This is useful when you need full access to the request details that aren't
 * available through the more specific parameter providers.
 *
 * Example:
 * ```ts
 * @Get()
 * handleRequest(@Context ctx: RequestContext) {
 *   const clientIP = ctx.rawRequest.socket.remoteAddress;
 *   const requestUrl = ctx.url.toString();
 *
 *   return new HTTPResult(200, { ip: clientIP, url: requestUrl });
 * }
 * ```
 */
export const Context = MakeParameterAndPropertyDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, (context) => context),
);

/**
 * Parameter Provider: HTTPResult object.
 *
 * Provides access to the response object, allowing modification of the
 * HTTP response that will be sent to the client.
 *
 * Note: This is typically used in a postfix handler to modify the final response.
 */
export const Result = MakeParameterDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, (context) => context.response),
);

/**
 * Parameter Provider: Response Write Stream.
 *
 * Provides a writable stream for sending data back to the client.
 * This is especially useful for streaming large responses or for
 * implementing server-sent events (SSE).
 *
 * @param type Content type for the stream (default: 'text/plain')
 *
 * Example:
 * ```ts
 * @Get('stream')
 * streamData(@WriteStream('application/octet-stream') stream: PassThrough) {
 *   // Write data to the stream over time
 *   streamData.write('Chunk 1');
 *
 *   setTimeout(() => {
 *     streamData.write('Chunk 2');
 *     streamData.end(); // Close the stream when done
 *   }, 1000);
 *
 *   // No return value needed when using streams
 * }
 * ```
 */
export const WriteStream = MakeParameterDecorator((target, key, param, type?: string) =>
  SetParameterProvider(target, key, param, (context) => context.response.getWriteStream(type)),
);

/**
 * Parameter Modifier: Generic Transformer.
 *
 * Applies a transformation function to the parameter value before it's passed to the handler.
 * This is useful for converting, validating, or enriching parameter values.
 *
 * @param transformer A function that takes the request context and the current parameter value,
 *                   and returns a transformed value
 *
 * Example:
 * ```ts
 * // Convert string ID to number
 * function parseId(context: RequestContext, value: unknown): number {
 *   return parseInt(value as string, 10);
 * }
 *
 * @Get('items/:id')
 * getItem(@Parameter('id') @Transform(parseId) id: number) {
 *   // id is now a number instead of a string
 *   return new HTTPResult(200, { id });
 * }
 * ```
 */
export const Transform = MakeParameterAndPropertyDecorator((target, key, param, transformer: ParameterModifier) =>
  AddParameterModifier(target, key, param, transformer),
);

/**
 * Parameter Provider: WebSocket Connection.
 *
 * Provides access to the WebSocket connection object for WebSocket handlers.
 * This allows you to interact with the WebSocket connection, such as sending
 * messages to the client or handling connection events.
 *
 * This provider can only be used with handlers decorated with @WebsocketHandler.
 *
 * Example:
 * ```ts
 * @WebsocketHandler('chat')
 * handleChatConnection(@Connection connection: WebSocketConnection) {
 *   connection.on('message', (data) => {
 *     // Handle incoming message
 *     connection.send('Received your message: ' + data);
 *   });
 *
 *   connection.on('close', () => {
 *     // Handle connection closed
 *   });
 * }
 * ```
 */
export const Connection = MakeParameterAndPropertyDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, (context) => context.connection),
);

/**
 * Parameter Provider: Multiple Request Parameter values.
 *
 * Extracts multiple values for a parameter from the request as an array.
 * This is useful for parameters that can appear multiple times in a request,
 * such as query parameters with the same name or multi-value headers.
 *
 * See {@link Parameter} for extracting single values.
 *
 * @param name Name of the parameter to extract
 * @param source Where to extract the parameter from:
 *   - 'query': URL query parameters (e.g., '/users?tag=js&tag=api' returns ['js', 'api'])
 *   - 'header': HTTP request headers with multiple values
 *
 * Example:
 * ```ts
 * @Get('search')
 * searchItems(@MultiParameter('tag') tags: string[]) {
 *   // For a request to /search?tag=js&tag=api
 *   // tags will be ['js', 'api']
 *
 *   return new HTTPResult(200, {
 *     tags,
 *     results: findItemsByTags(tags)
 *   });
 * }
 * ```
 */
export const MultiParameter = MakeParameterAndPropertyDecorator(
  (target, key, param, name: string, source: 'query' | 'header' = 'query') => {
    SetParameterProvider(target, key, param, (context) => {
      switch (source) {
        case 'query':
          return context.url.searchParams.getAll(name);
        case 'header': {
          const val = context.rawRequest.headers[name.toLowerCase()];
          return Array.isArray(val) ? val : val ? [val] : [];
        }
      }
    });
  },
);
