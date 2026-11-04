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
