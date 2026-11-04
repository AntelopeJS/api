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

/** The `then` of a thenable `Awaitable<T>`, read once, or `undefined` for a plain value. */
function thenOf<T>(value: Awaitable<T>): Then<T> | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  const then = thenProperty(value);
  return isThenOf(value, then) ? then : undefined;
}

/**
 * A value {@link thenOf} found no callable `then` on is the plain side of an
 * `Awaitable<T>`.
 */
function isPlainOf<T>(
  _value: Awaitable<T>,
  then: Then<T> | undefined,
): _value is T {
  return then === undefined;
}

function promiseThrough<T>(
  value: PromiseLike<T>,
  then: Then<T> | undefined,
): Promise<T> {
  if (value instanceof Promise) {
    return value;
  }
  if (then === undefined) {
    return Promise.resolve(value);
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

/**
 * Returns the promise a thenable settles through, or `undefined` for a plain
 * value. `then` is read exactly once; a native promise is returned as is, and
 * any other thenable is called on a later microtask, like `Promise.resolve`.
 */
export function pendingOf<T>(value: Awaitable<T>): Promise<T> | undefined {
  const then = thenOf(value);
  return isPlainOf(value, then) ? undefined : promiseThrough(value, then);
}

/**
 * Calls `next` with the value an `Awaitable<T>` settles with: at once for a
 * plain value, or once the promise {@link pendingOf} returns settles.
 */
export function continueWith<T, U>(
  value: Awaitable<T>,
  next: (result: T) => Awaitable<U>,
): Awaitable<U> {
  const then = thenOf(value);
  if (isPlainOf(value, then)) {
    return next(value);
  }
  // oxlint-disable-next-line promise/no-callback-in-promise -- continuation-passing keeps the synchronous fast path allocation-free
  return promiseThrough(value, then).then(next);
}
