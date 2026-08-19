import {
  type ComputedParameter,
  ControllerMeta,
  type CorsConfig,
  type RouteHandler,
} from "@antelopejs/interface-api";
import { GetMetadata } from "@antelopejs/interface-core";
import type { Class } from "@antelopejs/interface-core/decorators";
import { getConfig, listenServers, setCorsConfig } from "../../index";
import {
  type RequestContext,
  registerHandler,
  unregisterHandler,
} from "../../server";

type UnknownRecord = Record<PropertyKey, unknown>;

type ControllerClass = Class<unknown> & {
  location: string;
};

interface ControllerMetadata {
  computed_props: Record<PropertyKey, ComputedParameter>;
}

type ParameterResolver = (
  context: RequestContextDev,
  controllerInstance: UnknownRecord,
) => unknown;

interface ComputedPropertyResolver {
  key: string;
  resolve: ParameterResolver;
}

interface ControllerPlan {
  controllerClass: ControllerClass;
  cacheKey: object;
  computedProperties: ComputedPropertyResolver[];
}

interface HandlerPlan {
  callback: RouteHandler["callback"];
  controller: ControllerPlan;
  parameters: ParameterResolver[];
}

const classCacheSymbol = Symbol();
const registeredRoutes = new Map<string, RouteHandler>();
const controllerPlans = new WeakMap<ControllerClass, ControllerPlan>();

interface RequestContextDev extends RequestContext {
  [classCacheSymbol]?: Map<object, unknown>;
}

function getControllerCache(context: RequestContextDev): Map<object, unknown> {
  if (!context[classCacheSymbol]) {
    context[classCacheSymbol] = new Map<object, unknown>();
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
    return (context, controller) => provider.call(controller, context);
  }

  return async (context, controller) => {
    let value = await provider.call(controller, context);
    for (const modifier of modifiers) {
      value = await modifier.call(controller, context, value);
    }
    return value;
  };
}

function compileController(
  controllerClass: ControllerClass,
  properties: Record<PropertyKey, ComputedParameter>,
): ControllerPlan {
  const computedProperties = Object.entries(properties).map(
    ([key, parameter]) => ({
      key,
      resolve: compileParameter(parameter),
    }),
  );
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

  const metadata = GetMetadata(
    controllerClass,
    ControllerMeta,
  ) as ControllerMetadata;
  return compileController(controllerClass, metadata.computed_props);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function applyComputedProperties(
  controllerInstance: UnknownRecord,
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
): UnknownRecord | Promise<UnknownRecord> {
  const controllerCache = getControllerCache(context);
  const cachedController = controllerCache.get(plan.cacheKey) as
    | UnknownRecord
    | undefined;

  if (cachedController) {
    return cachedController;
  }

  const controllerInstance = new plan.controllerClass() as UnknownRecord;
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
): Promise<unknown> {
  const plan = getControllerPlan(controllerClass as ControllerClass);
  return resolveControllerInstance(plan, context as RequestContextDev);
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
  controllerInstance: UnknownRecord,
  context: RequestContextDev,
): unknown {
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

function invokeHandler(plan: HandlerPlan, context: RequestContextDev): unknown {
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
  const controllerClass = handler.proto.constructor as ControllerClass;
  return {
    callback: handler.callback,
    controller: compileController(controllerClass, handler.properties),
    parameters: handler.parameters.map(compileParameter),
  };
}

export const routesProxy = {
  register: (id: string, handler: RouteHandler): void => {
    registeredRoutes.set(id, handler);
    const plan = compileHandler(handler);
    registerHandler(
      `dev/${id}`,
      handler.mode,
      handler.method,
      handler.location,
      (context: RequestContextDev) => invokeHandler(plan, context),
      handler.priority,
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
