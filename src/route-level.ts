import type { HandlerPriority } from "@antelopejs/interface-api";

import type { RouteCallback } from "./request-context";

interface IdentifiableRouteCallback {
  id: string;
  callback: RouteCallback;
  priority: HandlerPriority;
}

export interface IndexedRouteCallback extends IdentifiableRouteCallback {
  exactPath?: string;
}

export interface DynamicRoute {
  match: RegExp;
  requiredPrefix: string;
  requiredSuffix: string;
  parameterName?: string;
  parameterNames: string[];
  sub: RouteLevel;
}

interface CatchAllRoute {
  paramName: string;
  suffix: string[];
  level: RouteLevel;
}

export class RouteLevel {
  handlers: IndexedRouteCallback[] = [];
  staticRoutes: Record<string, RouteLevel> = {};
  dynamicRoutes: Record<string, DynamicRoute> = {};
  dynamicRouteList: DynamicRoute[] = [];
  catchAllRoutes: CatchAllRoute[] = [];
}

export interface HandlerResult {
  handler: RouteCallback;
  parameters: Record<string, string>;
  priority: HandlerPriority;
}

const special = new Set([
  "$",
  "-",
  "_",
  ".",
  "+",
  "!",
  " ",
  "*",
  "'",
  "(",
  ")",
  ",",
]);

export function compileDynamicRoute(part: string): DynamicRoute {
  const mapping = [];
  const pattern = ["^"];
  let word: string[] | undefined;
  for (const char of part) {
    if (special.has(char)) {
      if (word) {
        mapping.push(word.join(""));
        pattern.push(`([^\\${char}]*)`);
        word = undefined;
      }
      pattern.push(`\\${char}`);
    } else if (char === ":") {
      if (word) {
        throw new Error("Invalid URL parameter");
      }
      word = [];
    } else if (char.match(/[a-zA-Z0-9]/)) {
      if (word) {
        word.push(char);
      } else {
        pattern.push(char);
      }
    } else {
      throw new Error("Invalid character in URL");
    }
  }
  if (word) {
    mapping.push(word.join(""));
    pattern.push(`(.*)`);
  }
  pattern.push("$");
  const firstParameter = part.indexOf(":");
  const lastParameter = part.lastIndexOf(":");
  let suffixStart = lastParameter + 1;
  while (suffixStart < part.length && /[a-zA-Z0-9]/.test(part[suffixStart])) {
    suffixStart += 1;
  }
  return {
    match: new RegExp(pattern.join("")),
    requiredPrefix: part.slice(0, firstParameter),
    requiredSuffix: part.slice(suffixStart),
    parameterName: mapping.length === 1 ? mapping[0] : undefined,
    parameterNames: mapping,
    sub: new RouteLevel(),
  };
}
