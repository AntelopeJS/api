/** A value, or a thenable that settles with it. */
export type Awaitable<T> = T | PromiseLike<T>;

type Then<T> = PromiseLike<T>["then"];

function isObjectLike<V>(value: V): value is V & object {
  return (
    value !== null && (typeof value === "object" || typeof value === "function")
  );
}

function thenProperty(value: { readonly then?: unknown }) {
  return value.then;
}

/**
 * A function-valued `then` makes the value a thenable (Promises/A+ 2.3.3.3),
 * so for an `Awaitable<T>` it is the `then` of its `PromiseLike<T>` side.
 */
function isThenOf<T>(_value: Awaitable<T>, then: unknown): then is Then<T> {
  return typeof then === "function";
}

/**
 * Returns the promise a thenable settles through, or `undefined` for a plain
 * value. `then` is read exactly once; a native promise is returned as is, and
 * any other thenable is called on a later microtask, like `Promise.resolve`.
 */
export function pendingOf<T>(value: Awaitable<T>): Promise<T> | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  const then = thenProperty(value);
  if (!isThenOf(value, then)) {
    return undefined;
  }
  if (value instanceof Promise) {
    return value;
  }
  return new Promise<T>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        then.call(value, resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  });
}
