import { Class } from '@ajs/core/beta/decorators';
import { IncomingMessage, ServerResponse } from 'http';
import { PassThrough } from 'stream';
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
export declare class HTTPResult {
  private status;
  private body;
  private contentType;
  private stream?;
  /**
   * Additional response headers
   *
   * TODO: make private?
   */
  readonly headers: Record<string, string>;
  /**
   * TODO
   *
   *
   *
   * Create a new HTTPResult from the given body or previous HTTPResult and the provided headers.
   *
   * @param res Body or HTTPResult
   * @param headers Additional headers
   * @param defaultStatus Status code
   * @returns New HTTPResult
   */
  static withHeaders(res: any, headers: Record<string, string>, defaultStatus?: number): HTTPResult;
  /**
   * @param status Status code
   * @param body Response body
   * @param type Content type
   */
  constructor(status?: number, body?: string | unknown, type?: string);
  /**
   * Set the response status.
   *
   * @param status Status code
   */
  setStatus(status: number): void;
  /**
   * Get the response status.
   *
   * @returns Status code
   */
  getStatus(): number;
  /**
   * Set the body of the response and its content type.
   *
   * @param body Body string or object
   * @param type Content type
   */
  setBody(body: any, type?: string): void;
  /**
   * Get the body of the response.
   *
   * @returns Body
   */
  getBody(): any;
  /**
   * Get the content type of the response.
   *
   * @returns Content type
   */
  getContentType(): string;
  /**
   * Add an additional header to the response.
   *
   * @param name Header name
   * @param value Header value
   */
  addHeader(name: string, value: string): void;
  /**
   * Remove an additional header from the response.
   *
   * @param name Header name
   */
  removeHeader(name: string): void;
  /**
   * Get the headers key-value store.
   *
   * @returns Headers object
   */
  getHeaders(): Record<string, string>;
  /**
   * Sets this response to be long-lived and gets its writable stream.
   *
   * @returns Response write stream
   */
  getWriteStream(type?: string, status?: number): PassThrough;
  /**
   * Tests if this response is in stream mode.
   *
   * @returns Stream mode enabled
   */
  isStream(): boolean;
  /**
   * Send response without the body.
   *
   * @param res Response object
   */
  sendHeadResponse(res: ServerResponse): void;
  /**
   * Send response.
   *
   * @param res Response object
   */
  sendResponse(res: ServerResponse, abortStream?: boolean): void;
}
/**
 * Handler priority enum.
 */
export declare enum HandlerPriority {
  HIGHEST = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
  LOWEST = 4,
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
  body?: undefined | Promise<Buffer> | unknown;
  /**
   * HTTPResponse object that will be sent on completion.
   */
  response: HTTPResult;
  /**
   * Websocket connection.
   */
  connection?: unknown;
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
export declare function computeParameter(
  context: RequestContext,
  param: ComputedParameter | null,
  obj: unknown,
): Promise<unknown>;
/**
 * Metadata Class containing the Controller information.
 */
export declare class ControllerMeta {
  /**
   * Key symbol
   */
  static key: symbol;
  /**
   * Full location or the controller
   */
  readonly location: string;
  /**
   * Computed properties of the Controller (available to every handler)
   */
  computed_props: Record<PropertyKey, ComputedParameter>;
  /**
   * Computed parameters (available only to its handler)
   */
  computed_params: Record<PropertyKey, Record<number, ComputedParameter>>;
  constructor(target: { location: string });
  inherit(parent: ControllerMeta): void;
  /**
   * Get the ComputedParameter on a given key
   *
   * @param key Handler key or Property key
   * @param param If used on a handler, parameter index
   * @returns ComputedParameter
   */
  getComputedParameter(key: PropertyKey, param: number | undefined): ComputedParameter;
  /**
   * Sets the parameter provider of the ComputedParameter on the given key
   *
   * @param key Handler key or Property key
   * @param param If used on a handler, parameter index
   * @param modifier Parameter provider
   */
  setProvider(key: PropertyKey, param: number | undefined, provider: ParameterProvider): void;
  /**
   * Adds a parameter modifier to the ComputedParameter on the given key
   *
   * @param key Handler key or Property key
   * @param param If used on a handler, parameter index
   * @param modifier Parameter modifier
   */
  addModifier(key: PropertyKey, param: number | undefined, modifier: ParameterModifier): void;
  /**
   * Get the list of ComputedParameter for a given handler
   *
   * @param key Handler key
   * @returns ComputedParameter list
   */
  getParameterArray(key: PropertyKey): (ComputedParameter | null)[];
}
/**
 * Create a new API Controller at the given root location.
 *
 * @param location Root location
 * @param base Optional base Controller to inherit properties from
 * @returns New Controller
 */
export declare function Controller<T extends {} = {}>(location: string, base?: Class<T>): ControllerClass<T>;
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
 * Register a RouteHandler to the API.
 *
 * @param handler Route handler
 * @returns New route ID
 */
export declare function RegisterRoute(handler: RouteHandler): number;
/**
 * Retrieves all registered routes with detailed information.
 * @returns {Array<Object>} An array of route information objects.
 */
export declare function getRegisteredRoutes(): Array<{
  id: string;
  location: string;
  method: string;
  callbackName: string;
  parameters: Array<ComputedParameter | null>;
  properties: Record<string, ComputedParameter>;
  priority?: HandlerPriority;
}>;
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
export declare function ProcessCallback(
  target: any,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  mode: RouteHandlerMode,
  method: string,
  location?: string,
  priority?: HandlerPriority,
): {
  id: number;
};
/**
 * Generic endpoint (route) decorator.
 *
 * @param mode Handler mode (prefix, handler, postfix, websocket)
 * @param method HTTP method
 * @param location Endpoint location
 * @param priority Handler priority
 */
export declare const Route: (
  mode: RouteHandlerMode,
  method: string,
  location?: string | undefined,
  priority?: HandlerPriority | undefined,
) => import('@ajs/core/beta/decorators').MethodDecorator;
/**
 * DELETE endpoint (route) decorator.
 *
 * @param location Endpoint location
 * @param mode Handler mode (prefix, handler, postfix, websocket) (default 'handler')
 */
export declare const Delete: (
  location?: string | undefined,
  mode?: RouteHandlerMode | undefined,
) => import('@ajs/core/beta/decorators').MethodDecorator;
/**
 * GET endpoint (route) decorator.
 *
 * @param location Endpoint location
 * @param mode Handler mode (prefix, handler, postfix, websocket) (default 'handler')
 */
export declare const Get: (
  location?: string | undefined,
  mode?: RouteHandlerMode | undefined,
) => import('@ajs/core/beta/decorators').MethodDecorator;
/**
 * POST endpoint (route) decorator.
 *
 * @param location Endpoint location
 * @param mode Handler mode (prefix, handler, postfix, websocket) (default 'handler')
 */
export declare const Post: (
  location?: string | undefined,
  mode?: RouteHandlerMode | undefined,
) => import('@ajs/core/beta/decorators').MethodDecorator;
/**
 * PUT endpoint (route) decorator.
 *
 * @param location Endpoint location
 * @param mode Handler mode (prefix, handler, postfix, websocket) (default 'handler')
 */
export declare const Put: (
  location?: string | undefined,
  mode?: RouteHandlerMode | undefined,
) => import('@ajs/core/beta/decorators').MethodDecorator;
/**
 * Generic prefix route decorator.
 *
 * @param method HTTP method
 * @param location Endpoint location
 * @param mode Handler mode (prefix, handler, postfix, websocket)
 */
export declare const Prefix: (
  method: string,
  location?: string | undefined,
  priority?: HandlerPriority | undefined,
) => import('@ajs/core/beta/decorators').MethodDecorator;
/**
 * Generic postfix route decorator.
 *
 * @param method HTTP method
 * @param location Endpoint location
 * @param mode Handler mode (prefix, handler, postfix, websocket)
 */
export declare const Postfix: (
  method: string,
  location?: string | undefined,
  priority?: HandlerPriority | undefined,
) => import('@ajs/core/beta/decorators').MethodDecorator;
/**
 * Websocket endpoint (route) decorator.
 *
 * @param location Endpoint location
 */
export declare const WebsocketHandler: (
  location?: string | undefined,
) => import('@ajs/core/beta/decorators').MethodDecorator;
/**
 * Get the body from a RequestContext object.
 *
 * @param context Request context
 * @returns Body buffer
 */
export declare function ReadBody(context: RequestContext): Promise<unknown>;
/**
 * Set the ParameterProvider on a Handler or Property.
 *
 * @param target Controller class
 * @param key Handler key or Property key
 * @param index If used on a handler, parameter index
 * @param provider ParameterProvider
 */
export declare function SetParameterProvider(
  target: any,
  key: PropertyKey,
  index: number | undefined,
  provider: ParameterProvider,
): void;
/**
 * Add a ParameterModifier on a Handler or Property.
 *
 * @param target Controller class
 * @param key Handler key or Property key
 * @param index If used on a handler, parameter index
 * @param transformer ParameterModifier
 */
export declare function AddParameterModifier(
  target: any,
  key: PropertyKey,
  index: number | undefined,
  transformer: ParameterModifier,
): void;
/**
 * Parameter Provider: Request Body.
 */
export declare const RawBody: () => import('@ajs/core/beta/decorators').PropertyDecorator &
  import('@ajs/core/beta/decorators').ParameterDecorator;
/**
 * Parameter Provider: Request Parameter.
 *
 * This provider will always return at most one value in the case of query and header sources.
 * See {@link MultiParameter} for multiple values.
 *
 * The source parameter dictates where the parameter should be acquired from:
 * - param: Route parameters (ex `/myroute/:name/`)
 * - query: URL Query section (ex `/myroute?name=value`)
 * - header: Request Headers
 *
 * @param name Name of the parameter
 * @param source Source (param, query, header) (default 'param')
 */
export declare const Parameter: (
  name: string,
  source?: 'param' | 'query' | 'header' | undefined,
) => import('@ajs/core/beta/decorators').PropertyDecorator & import('@ajs/core/beta/decorators').ParameterDecorator;
/**
 * Parameter Provider: Request Parameter array.
 *
 * This provider will always return an array of values.
 * See {@link Parameter} for single values.
 *
 * The source parameter dictates where the parameter should be acquired from:
 * - query: URL Query section (ex `/myroute?name=value`)
 * - header: Request Headers
 *
 * @param name Name of the parameter
 * @param source Source (query, header) (default 'query')
 */
export declare const MultiParameter: (
  name: string,
  source?: 'query' | 'header' | undefined,
) => import('@ajs/core/beta/decorators').PropertyDecorator & import('@ajs/core/beta/decorators').ParameterDecorator;
/**
 * Parameter Provider: Request Context.
 */
export declare const Context: () => import('@ajs/core/beta/decorators').PropertyDecorator &
  import('@ajs/core/beta/decorators').ParameterDecorator;
/**
 * Parameter Provider: Websocket Connection.
 */
export declare const Connection: () => import('@ajs/core/beta/decorators').PropertyDecorator &
  import('@ajs/core/beta/decorators').ParameterDecorator;
/**
 * Parameter Provider: HTTPResult object.
 *
 * Note: Usually used in a postfix.
 */
export declare const Result: () => import('@ajs/core/beta/decorators').ParameterDecorator;
/**
 * Parameter Provider: Response Write Stream.
 */
export declare const WriteStream: (type?: string | undefined) => import('@ajs/core/beta/decorators').ParameterDecorator;
/**
 * Parameter Modifier: Generic Transformer.
 *
 * @param transformer ParameterModifier
 */
export declare const Transform: (
  transformer: ParameterModifier,
) => import('@ajs/core/beta/decorators').PropertyDecorator & import('@ajs/core/beta/decorators').ParameterDecorator;
