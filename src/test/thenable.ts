import type { RouteResult } from "../request-context";

const THEN_PROPERTY = ["th", "en"].join("");

/**
 * Builds a null-prototype object that is a thenable only through a `then`
 * property defined by `descriptor` under a computed name.
 */
export function nullPrototypeThenable(descriptor: PropertyDescriptor): object {
  const thenable = {};
  Reflect.setPrototypeOf(thenable, null);
  return Object.defineProperty(thenable, THEN_PROPERTY, descriptor);
}

/**
 * The fixture defines a `then` of its own: a function, or a getter, which is
 * not called so that a test can count its reads.
 */
function hasOwnThen(
  thenable: Partial<PromiseLike<RouteResult>>,
): thenable is PromiseLike<RouteResult> {
  const descriptor = Reflect.getOwnPropertyDescriptor(thenable, THEN_PROPERTY);
  return (
    typeof descriptor?.get === "function" ||
    typeof descriptor?.value === "function"
  );
}

/**
 * {@link nullPrototypeThenable} typed for a route callback, which returns a
 * `RouteResult` or a thenable settling with one.
 */
export function nullPrototypeRouteThenable(
  descriptor: PropertyDescriptor,
): PromiseLike<RouteResult> {
  const thenable: Partial<PromiseLike<RouteResult>> = {};
  Reflect.setPrototypeOf(thenable, null);
  Object.defineProperty(thenable, THEN_PROPERTY, descriptor);
  if (!hasOwnThen(thenable)) {
    throw new TypeError("The descriptor defines no then");
  }
  return thenable;
}
