import type { VerifyConfig } from "@antelopejs/tooling-configs/verify";

import { bodyLimits, bodyReading, bodyStreaming } from "./journeys-bodies.ts";
import { configVariables, manifest } from "./journeys-config.ts";
import { requestContext } from "./journeys-context.ts";
import { corsConfig, corsDefaults, corsRuntime } from "./journeys-cors.ts";
import { startupGate } from "./journeys-gate.ts";
import { handlerModes, handlerPriority, postfixChain } from "./journeys-handlers.ts";
import { controllerInstances } from "./journeys-instances.ts";
import { multiParameters, parameterSources, propertyParameters } from "./journeys-params.ts";
import { parameterModifiers, parameterProviders, parameterTransform } from "./journeys-modifiers.ts";
import { customDecorators, legacyProto, routeRegistration } from "./journeys-registration.ts";
import { resultBodies, resultErrors, resultHeaders, responseStreaming } from "./journeys-results.ts";
import { controllerTree, routeForms } from "./journeys-routes.ts";
import { devRegistry, listenOnDemand, portFallback, productionBoot, serverOptions, serverPorts, serverProtocols } from "./journeys-servers.ts";
import { assertGuards, assertValidations, rateLimitOrdering, rateLimiting } from "./journeys-util.ts";
import { websocketHandlers } from "./journeys-websocket.ts";

const config: VerifyConfig = {
  doors: {
    data: null,
    format: null,
    contract: {
      globs: ["package.json", "src/config-vars.ts", "src/server-config.ts"],
      funnels: [],
      containments: [],
      why: "`antelopeJs.implements`, `configVars`, `configVarsFile` and `defaultConfig`, and the config keys `servers`, `publicBaseUrl`, `strictPort`, `autoListen` and `cors` that antelope.config.ts files already carry",
    },
    outbound: null,
    exposure: {
      globs: ["src/middlewares/cors.ts", "src/startup-gate.ts", "src/port-binding.ts", "src/port-listener.ts", "src/server-factory.ts", "src/server-origin.ts"],
      funnels: [],
      containments: [],
      why: "these modules decide which origins, hosts, ports and phases of the project can reach the routes: a change that widens an origin, binds another host or opens the gate early exposes routes to callers that were refused",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      containments: [],
      why: "the package name and release workflow claim @antelopejs/api on npm",
    },
  },
  moduleConfig() {
    return { servers: [{ protocol: "http", host: "127.0.0.1", port: 0 }] };
  },
  journeys: {
    "route-forms": routeForms,
    "controller-tree": controllerTree,
    "handler-modes": handlerModes,
    "handler-priority": handlerPriority,
    "postfix-chain": postfixChain,
    "parameter-sources": parameterSources,
    "multi-parameters": multiParameters,
    "property-parameters": propertyParameters,
    "parameter-modifiers": parameterModifiers,
    "parameter-transform": parameterTransform,
    "parameter-providers": parameterProviders,
    "controller-instances": controllerInstances,
    "route-registration": routeRegistration,
    "custom-decorators": customDecorators,
    "legacy-proto": legacyProto,
    "body-reading": bodyReading,
    "body-limits": bodyLimits,
    "body-streaming": bodyStreaming,
    "request-context": requestContext,
    "result-bodies": resultBodies,
    "result-headers": resultHeaders,
    "result-errors": resultErrors,
    "response-streaming": responseStreaming,
    "cors-config": corsConfig,
    "cors-defaults": corsDefaults,
    "cors-runtime": corsRuntime,
    "assert-guards": assertGuards,
    "assert-validations": assertValidations,
    "rate-limiting": rateLimiting,
    "rate-limit-ordering": rateLimitOrdering,
    "websocket-handlers": websocketHandlers,
    "server-ports": serverPorts,
    "port-fallback": portFallback,
    "server-protocols": serverProtocols,
    "server-options": serverOptions,
    "dev-registry": devRegistry,
    "listen-on-demand": listenOnDemand,
    "production-boot": productionBoot,
    "startup-gate": startupGate,
    "config-variables": configVariables,
    manifest,
  },
};

export default config;
