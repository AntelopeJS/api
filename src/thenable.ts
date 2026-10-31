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
 * A value whose `then` is not callable ({@link isThenOf} answered false) is
 * the plain side of an `Awaitable<T>`.
 */
function isPlainOf<T>(_value: Awaitable<T>, thenable: boolean): _value is T {
  return !thenable;
}

function isNativePromise<T>(value: PromiseLike<T>): value is Promise<T> {
  return value instanceof Promise;
}

/** How an `Awaitable<T>` continues: a promise to wait for, or its value now. */
export type Settlement<T> =
  | { kind: "pending"; promise: Promise<T> }
  | { kind: "settled"; value: T };

/**
 * Splits an `Awaitable<T>` into the promise a thenable settles through or the
 * plain value. `then` is read exactly once; a native promise is returned as
 * is, and any other thenable is called on a later microtask, like
 * `Promise.resolve`.
 */
export function settle<T>(value: Awaitable<T>): Settlement<T> {
  if (!isObjectLike(value)) {
    return { kind: "settled", value };
  }
  const then = thenProperty(value);
  if (isPlainOf(value, isThenOf(value, then))) {
    return { kind: "settled", value };
  }
  if (isNativePromise(value)) {
    return { kind: "pending", promise: value };
  }
  const promise = new Promise<T>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        if (isThenOf(value, then)) {
          then.call(value, resolve, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  });
  return { kind: "pending", promise };
}

/**
 * Returns the promise a thenable settles through, or `undefined` for a plain
 * value (see {@link settle}).
 */
export function pendingOf<T>(value: Awaitable<T>): Promise<T> | undefined {
  const settlement = settle(value);
  return settlement.kind === "pending" ? settlement.promise : undefined;
}
