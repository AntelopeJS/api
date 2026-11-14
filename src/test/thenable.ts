/** A thenable together with the number of times its `then` was read. */
export interface CountedThenable<T> {
  readCount: () => number;
  value: PromiseLike<T>;
}

function withoutPrototype<T extends object>(value: T): T {
  Reflect.setPrototypeOf(value, null);
  return value;
}

/**
 * Builds a null-prototype thenable that settles like `settled`, so only its
 * own `then` makes it awaitable.
 */
export function nullPrototypeThenable<T>(
  settled: () => PromiseLike<T>,
): PromiseLike<T> {
  return withoutPrototype<PromiseLike<T>>({
    then: (onfulfilled, onrejected) => settled().then(onfulfilled, onrejected),
  });
}

/**
 * Builds a null-prototype thenable that fulfills with `value` and throws if
 * its `then` getter is read more than once.
 */
export function countedThenable<T>(value: T): CountedThenable<T> {
  let reads = 0;
  const thenable = withoutPrototype<PromiseLike<T>>({
    get then(): PromiseLike<T>["then"] {
      reads += 1;
      if (reads > 1) {
        throw new Error("then getter read more than once");
      }
      return (onfulfilled, onrejected) =>
        Promise.resolve(value).then(onfulfilled, onrejected);
    },
  });
  return { readCount: () => reads, value: thenable };
}
