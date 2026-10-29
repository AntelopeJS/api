import type { DynamicRoute, HandlerResult, RouteLevel } from "./route-level";

function hasParameter(parameters: Record<string, string>, name: string) {
  return Object.getOwnPropertyDescriptor(parameters, name) !== undefined;
}

export interface HandlerSearch {
  path: string[];
  result: HandlerResult[];
  parameters: Record<string, string>;
  parameterCount: number;
  multi: boolean;
  exactPath?: string;
}

export function isSettled(search: HandlerSearch): boolean {
  return search.result.length > 0 && !search.multi;
}

function restoreParameter(
  parameters: Record<string, string>,
  name: string,
  existingParameter: boolean,
  previousValue: string,
): void {
  if (existingParameter) {
    parameters[name] = previousValue;
  } else {
    delete parameters[name];
  }
}

function searchWithParameter(
  search: HandlerSearch,
  depth: number,
  level: RouteLevel,
  name: string,
  value: string,
): boolean {
  const { parameters } = search;
  const previousValue = parameters[name];
  const existingParameter =
    search.parameterCount > 0 && hasParameter(parameters, name);
  parameters[name] = value;
  search.parameterCount += 1;
  findHandlers(search, depth, level);
  if (isSettled(search)) {
    return true;
  }
  search.parameterCount -= 1;
  restoreParameter(parameters, name, existingParameter, previousValue);
  return false;
}

function searchWithParameters(
  search: HandlerSearch,
  depth: number,
  route: DynamicRoute,
  match: RegExpExecArray,
): boolean {
  const { parameters } = search;
  const names = route.parameterNames;
  const previousValues = names.map((name) => parameters[name]);
  const existingParameters = names.map((name) =>
    hasParameter(parameters, name),
  );
  for (let index = 0; index < names.length; ++index) {
    parameters[names[index]] = match[index + 1];
  }
  search.parameterCount += names.length;
  findHandlers(search, depth, route.sub);
  if (isSettled(search)) {
    return true;
  }
  search.parameterCount -= names.length;
  for (let index = 0; index < names.length; ++index) {
    restoreParameter(
      parameters,
      names[index],
      existingParameters[index],
      previousValues[index],
    );
  }
  return false;
}

function searchDynamicRoutes(
  search: HandlerSearch,
  depth: number,
  level: RouteLevel,
): boolean {
  const part = search.path[depth];
  for (const route of level.dynamicRouteList) {
    if (
      (route.requiredPrefix && !part.startsWith(route.requiredPrefix)) ||
      (route.requiredSuffix && !part.endsWith(route.requiredSuffix))
    ) {
      continue;
    }
    const match = route.match.exec(part);
    if (!match) {
      continue;
    }
    const isFound =
      route.parameterName === undefined
        ? searchWithParameters(search, depth + 1, route, match)
        : searchWithParameter(
            search,
            depth + 1,
            route.sub,
            route.parameterName,
            match[1],
          );
    if (isFound) {
      return true;
    }
  }
  return false;
}

function endsWithSuffix(path: string[], suffix: string[]): boolean {
  const suffixStart = path.length - suffix.length;
  for (let i = 0; i < suffix.length; ++i) {
    if (path[suffixStart + i] !== suffix[i]) {
      return false;
    }
  }
  return true;
}

function searchCatchAllRoutes(
  search: HandlerSearch,
  depth: number,
  level: RouteLevel,
): void {
  const { path } = search;
  for (const catchAll of level.catchAllRoutes) {
    const remaining = path.length - depth;
    const suffixLen = catchAll.suffix.length;

    if (remaining < 1 + suffixLen) {
      continue;
    }

    if (suffixLen > 0 && !endsWithSuffix(path, catchAll.suffix)) {
      continue;
    }

    const captured = path.slice(depth, path.length - suffixLen);
    if (captured.length < 1) {
      continue;
    }

    const isFound = searchWithParameter(
      search,
      path.length,
      catchAll.level,
      catchAll.paramName,
      captured.join("/"),
    );
    if (isFound) {
      return;
    }
  }
}

function collectHandlers(search: HandlerSearch, level: RouteLevel): void {
  for (const handler of level.handlers) {
    search.result.push({
      handler: handler.callback,
      parameters: { ...search.parameters },
      priority: handler.priority,
    });
  }
}

export function findHandlers(
  search: HandlerSearch,
  depth: number,
  level: RouteLevel,
): void {
  if (search.multi) {
    collectHandlers(search, level);
  }
  if (depth >= search.path.length) {
    if (!search.multi && level.handlers.length > 0) {
      search.result.push({
        handler: level.handlers[0].callback,
        parameters: search.parameters,
        priority: level.handlers[0].priority,
      });
    }
    return;
  }

  const part = search.path[depth];

  if (part in level.staticRoutes) {
    findHandlers(search, depth + 1, level.staticRoutes[part]);
    if (isSettled(search)) {
      return;
    }
  }

  if (searchDynamicRoutes(search, depth, level)) {
    return;
  }

  searchCatchAllRoutes(search, depth, level);
}
