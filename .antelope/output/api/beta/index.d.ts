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
     */
    private readonly headers;
    /**
     * Create a new HTTPResult from the given body or previous HTTPResult and the provided headers.
     *
     * @param res Body or HTTPResult - The content to be included in the response
     * @param headers Additional headers to apply to the response
     * @param defaultStatus Status code to use if creating a new HTTPResult (default: 200)
     * @returns New HTTPResult with the specified headers
     */
    static withHeaders(res: any, headers: Record<string, string>, defaultStatus?: number): HTTPResult;
    /**
     * @param status Status code
     * @param body Response body
     * @param type Content type
     */
    constructor(status?: number, body?: unknown, type?: string);
    /**
     * Set the response status.
     *
     * @param status HTTP status code (e.g., 200, 404, 500)
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
     * Use this for long-running responses like Server-Sent Events or streaming data.
     *
     * @param type Content type for the stream (default: 'text/plain')
     * @param status HTTP status code for the response (default: 200)
     * @returns Response write stream for sending data
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
 * Controls the execution order for handlers when multiple handlers match a route.
 * Lower values indicate higher priority and will execute first.
 */
export declare enum HandlerPriority {
    HIGHEST = 0,// Executes first
    HIGH = 1,
    NORMAL = 2,// Default priority
    LOW = 3,
    LOWEST = 4
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
export declare function computeParameter(context: RequestContext, param: ComputedParameter | null, obj: unknown): Promise<unknown>;
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
    constructor(target: {
        location: string;
    });
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
export declare function Controller<T extends object = object>(location: string, base?: Class<T>): ControllerClass<T>;
/**
 * Gets the instance of a given Controller for the active request.
 *
 * @param cl Controller class
 * @param context Request context
 * @returns Controller instance
 */
export declare const GetControllerInstance: <T>(cl: Class<T>, context: RequestContext) => Promise<T>;
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
export declare function ProcessCallback(target: any, key: PropertyKey, descriptor: PropertyDescriptor, mode: RouteHandlerMode, method: string, location?: string, priority?: HandlerPriority): {
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
export declare const Route: (mode: RouteHandlerMode, method: string, location?: string | undefined, priority?: HandlerPriority | undefined) => import("@ajs/core/beta/decorators").MethodDecorator;
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
export declare const Delete: (location?: string | undefined, mode?: RouteHandlerMode | undefined) => import("@ajs/core/beta/decorators").MethodDecorator;
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
export declare const Get: (location?: string | undefined, mode?: RouteHandlerMode | undefined) => import("@ajs/core/beta/decorators").MethodDecorator;
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
export declare const Post: (location?: string | undefined, mode?: RouteHandlerMode | undefined) => import("@ajs/core/beta/decorators").MethodDecorator;
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
export declare const Put: (location?: string | undefined, mode?: RouteHandlerMode | undefined) => import("@ajs/core/beta/decorators").MethodDecorator;
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
export declare const Prefix: (method: string, location?: string | undefined, priority?: HandlerPriority | undefined) => import("@ajs/core/beta/decorators").MethodDecorator;
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
export declare const Postfix: (method: string, location?: string | undefined, priority?: HandlerPriority | undefined) => import("@ajs/core/beta/decorators").MethodDecorator;
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
export declare const WebsocketHandler: (location?: string | undefined) => import("@ajs/core/beta/decorators").MethodDecorator;
/**
 * Get the body from a RequestContext object.
 *
 * @param context Request context
 * @returns Body buffer
 */
export declare function ReadBody(context: RequestContext): unknown;
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
export declare function SetParameterProvider(target: any, key: PropertyKey, index: number | undefined, provider: ParameterProvider): void;
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
export declare function AddParameterModifier(target: any, key: PropertyKey, index: number | undefined, transformer: ParameterModifier): void;
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
export declare const RawBody: () => import("@ajs/core/beta/decorators").PropertyDecorator & import("@ajs/core/beta/decorators").ParameterDecorator;
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
export declare const Parameter: (name: string, source?: "param" | "query" | "header" | undefined) => import("@ajs/core/beta/decorators").PropertyDecorator & import("@ajs/core/beta/decorators").ParameterDecorator;
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
export declare const Context: () => import("@ajs/core/beta/decorators").PropertyDecorator & import("@ajs/core/beta/decorators").ParameterDecorator;
/**
 * Parameter Provider: HTTPResult object.
 *
 * Provides access to the response object, allowing modification of the
 * HTTP response that will be sent to the client.
 *
 * Note: This is typically used in a postfix handler to modify the final response.
 */
export declare const Result: () => import("@ajs/core/beta/decorators").ParameterDecorator;
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
export declare const WriteStream: (type?: string | undefined) => import("@ajs/core/beta/decorators").ParameterDecorator;
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
export declare const Transform: (transformer: ParameterModifier) => import("@ajs/core/beta/decorators").PropertyDecorator & import("@ajs/core/beta/decorators").ParameterDecorator;
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
export declare const Connection: () => import("@ajs/core/beta/decorators").PropertyDecorator & import("@ajs/core/beta/decorators").ParameterDecorator;
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
export declare const MultiParameter: (name: string, source?: "query" | "header" | undefined) => import("@ajs/core/beta/decorators").PropertyDecorator & import("@ajs/core/beta/decorators").ParameterDecorator;
