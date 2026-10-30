import { GetMetadata } from "@antelopejs/interface-core";
import type { Class } from "@antelopejs/interface-core/decorators";
import {
  type ComputedParameter,
  ControllerMeta,
  type CorsConfig,
  HTTPResult,
  type ParameterModifier,
  type RequestContext,
  type RouteHandler,
} from "@antelopejs/interface-api";

import { getConfig, listenServers, setCorsConfig } from "../../index";
import {
  type RouteResult,
  registerHandler,
  unregisterHandler,
} from "../../server";
import { type Awaitable, pendingOf } from "../../thenable";

type ComputedValue = ReturnType<ParameterModifier>;

type ControllerInstance = Record<PropertyKey, ComputedValue>;

type ControllerClass = Class<ControllerInstance> & {
  location: string;
  prototype: object;
};

type ParameterResolver = (
  context: RequestContextDev,
  controllerInstance: ControllerInstance,
) => Awaitable<ComputedValue>;

interface ComputedPropertyResolver {
  key: PropertyKey;
  resolve: ParameterResolver;
}

interface ControllerPlan {
  controllerClass: ControllerClass;
  cacheKey: object;
  computedProperties: ComputedPropertyResolver[];
}

type HandlerCallback = (...args: ComputedValue[]) => RouteResult;

interface HandlerPlan {
  callback: HandlerCallback;
  controller: ControllerPlan;
  parameters: ParameterResolver[];
}

const BAD_REQUEST_STATUS = 400;
const MALFORMED_REQUEST_PREFIX = "Malformed request";

const classCacheSymbol = Symbol();
const registeredRoutes = new Map<string, RouteHandler>();
const controllerPlans = new WeakMap<ControllerClass, ControllerPlan>();

interface RequestContextDev extends RequestContext {
  [classCacheSymbol]?: Map<object, ControllerInstance>;
}

function getControllerCache(
  context: RequestContextDev,
): Map<object, ControllerInstance> {
  if (!context[classCacheSymbol]) {
    context[classCacheSymbol] = new Map<object, ControllerInstance>();
  }

  return context[classCacheSymbol];
}

function compileParameter(
  parameter: ComputedParameter | null,
): ParameterResolver {
  if (!parameter?.provider) {
    return () => undefined;
  }

  const { provider } = parameter;
  const modifiers = [...parameter.modifiers];
  if (modifiers.length === 0) {
    return (context, controller) => callProvider(provider, controller, context);
  }

  return (context, controller) =>
    applyModifiers(
      callProvider(provider, controller, context),
      modifiers,
      context,
      controller,
    );
}

function toRequestError(error: RequestContext["error"]) {
  if (!(error instanceof SyntaxError)) {
    return error;
  }
  return new HTTPResult(
    BAD_REQUEST_STATUS,
    `${MALFORMED_REQUEST_PREFIX}: ${error.message}`,
  );
}

function rejectAsRequestError(error: RequestContext["error"]): never {
  throw toRequestError(error);
}

function callProvider(
  provider: NonNullable<ComputedParameter["provider"]>,
  controller: ControllerInstance,
  context: RequestContextDev,
): Awaitable<ComputedValue> {
  try {
    const value = provider.call(controller, context);
    const pending = pendingOf(value);
    return pending ? pending.catch(rejectAsRequestError) : value;
  } catch (error) {
    return rejectAsRequestError(error);
  }
}

function applyModifiers(
  initialValue: Awaitable<ComputedValue>,
  modifiers: ComputedParameter["modifiers"],
  context: RequestContextDev,
  controller: ControllerInstance,
  startIndex = 0,
): Awaitable<ComputedValue> {
  let value = initialValue;
  for (let index = startIndex; index < modifiers.length; index += 1) {
    const pending = pendingOf(value);
    if (pending) {
      return pending.then((resolved) =>
        applyModifiers(resolved, modifiers, context, controller, index),
      );
    }
    value = modifiers[index].call(controller, context, value);
  }
  return pendingOf(value) ?? value;
}

function ownEntries(
  table: Record<PropertyKey, ComputedParameter>,
): Array<[PropertyKey, ComputedParameter]> {
  const bySymbol: Record<symbol, ComputedParameter> = table;
  const symbols = Object.getOwnPropertySymbols(bySymbol).map(
    (symbol): [PropertyKey, ComputedParameter] => [symbol, bySymbol[symbol]],
  );
  return [...Object.entries(table), ...symbols];
}

function compileController(
  controllerClass: ControllerClass,
  properties: Record<PropertyKey, ComputedParameter>,
): ControllerPlan {
  const computedProperties = ownEntries(properties).map(([key, parameter]) => ({
    key,
    resolve: compileParameter(parameter),
  }));
  const existingPlan = controllerPlans.get(controllerClass);
  const plan = existingPlan ?? {
    controllerClass,
    cacheKey: controllerClass.prototype,
    computedProperties,
  };
  plan.computedProperties = computedProperties;
  controllerPlans.set(controllerClass, plan);
  return plan;
}

function getControllerPlan(controllerClass: ControllerClass): ControllerPlan {
  const cachedPlan = controllerPlans.get(controllerClass);
  if (cachedPlan) {
    return cachedPlan;
  }

  const metadata = GetMetadata(controllerClass, ControllerMeta);
  return compileController(controllerClass, metadata.computed_props);
}

function isPromiseLike<V>(value: Awaitable<V>): value is PromiseLike<V> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function applyComputedProperties(
  controllerInstance: ControllerInstance,
  computedProperties: ComputedPropertyResolver[],
  context: RequestContextDev,
): void | Promise<void> {
  if (computedProperties.length === 0) {
    return;
  }

  const pending: Promise<void>[] = [];
  for (const property of computedProperties) {
    const value = property.resolve(context, controllerInstance);
    if (isPromiseLike(value)) {
      pending.push(
        Promise.resolve(value).then((resolved) => {
          controllerInstance[property.key] = resolved;
        }),
      );
    } else {
      controllerInstance[property.key] = value;
    }
  }

  if (pending.length > 0) {
    return Promise.all(pending).then(() => undefined);
  }
}

function resolveControllerInstance(
  plan: ControllerPlan,
  context: RequestContextDev,
): ControllerInstance | Promise<ControllerInstance> {
  const controllerCache = getControllerCache(context);
  const cachedController = controllerCache.get(plan.cacheKey);

  if (cachedController) {
    return cachedController;
  }

  const controllerInstance = new plan.controllerClass();
  const computed = applyComputedProperties(
    controllerInstance,
    plan.computedProperties,
    context,
  );
  if (computed) {
    return computed.then(() => {
      controllerCache.set(plan.cacheKey, controllerInstance);
      return controllerInstance;
    });
  }

  controllerCache.set(plan.cacheKey, controllerInstance);
  return controllerInstance;
}

export async function GetControllerInstance(
  controllerClass: Class<unknown>,
  context: RequestContext,
) {
  const plan = getControllerPlan(controllerClass as ControllerClass);
  return resolveControllerInstance(plan, context);
}

export async function Listen(): Promise<void> {
  await listenServers();
}

export function GetCorsConfig(): CorsConfig {
  return getConfig().cors ?? {};
}

export function SetCorsConfig(config: CorsConfig): void {
  setCorsConfig(config);
}

interface RouteInfo {
  id: string;
  uri: string;
  method: string;
  mode: "prefix" | "postfix" | "handler" | "monitor" | "websocket";
  priority?: number;
  callbackName: string;
}

function invokeCallback(
  plan: HandlerPlan,
  controllerInstance: ControllerInstance,
  context: RequestContextDev,
): Awaitable<RouteResult> {
  if (plan.parameters.length === 0) {
    return plan.callback.call(controllerInstance);
  }
  if (plan.parameters.length === 1) {
    const parameter = plan.parameters[0](context, controllerInstance);
    if (isPromiseLike(parameter)) {
      return Promise.resolve(parameter).then((resolved) =>
        plan.callback.call(controllerInstance, resolved),
      );
    }
    return plan.callback.call(controllerInstance, parameter);
  }

  const parameters = plan.parameters.map((resolve) =>
    resolve(context, controllerInstance),
  );
  if (parameters.some(isPromiseLike)) {
    return Promise.all(parameters).then((resolved) =>
      plan.callback.apply(controllerInstance, resolved),
    );
  }
  return plan.callback.apply(controllerInstance, parameters);
}

function invokeHandler(
  plan: HandlerPlan,
  context: RequestContextDev,
): Awaitable<RouteResult> {
  const controllerInstance = resolveControllerInstance(
    plan.controller,
    context,
  );
  if (isPromiseLike(controllerInstance)) {
    return Promise.resolve(controllerInstance).then((resolved) =>
      invokeCallback(plan, resolved, context),
    );
  }
  return invokeCallback(plan, controllerInstance, context);
}

function compileHandler(handler: RouteHandler): HandlerPlan {
  const controllerClass: ControllerClass = handler.proto.constructor;
  return {
    callback: handler.callback,
    controller: compileController(controllerClass, handler.properties),
    parameters: handler.parameters.map(compileParameter),
  };
}

export const routesProxy = {
  register: (id: string, handler: RouteHandler): void => {
    registeredRoutes.set(id, handler);
    let plan: HandlerPlan | undefined;
    registerHandler(
      `dev/${id}`,
      {
        mode: handler.mode,
        method: handler.method,
        location: handler.location,
        priority: handler.priority,
      },
      (context: RequestContextDev) => {
        plan ??= compileHandler(handler);
        return invokeHandler(plan, context);
      },
    );
  },
  unregister: (id: string): void => {
    registeredRoutes.delete(id);
    unregisterHandler(`dev/${id}`);
  },
  getRoutes: (): RouteInfo[] => {
    const routes: RouteInfo[] = [];

    registeredRoutes.forEach((handler, id) => {
      routes.push({
        id,
        uri: handler.location,
        method: handler.method,
        mode: handler.mode,
        priority: handler.priority,
        callbackName: handler.callback.name || "anonymous",
      });
    });

    return routes;
  },
};

export const internal = { routesProxy };
