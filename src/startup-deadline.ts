let listenDeadline: NodeJS.Timeout | undefined;

/**
 * Resolves `true` once `task` settles, or `false` if `timeoutMs` elapses
 * first, so a stuck step can never block the startup sequence for good.
 */
export function settlesWithin(
  task: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });

  return Promise.race([task.then(() => true), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Calls `onMissed` unless `disarmListenDeadline` runs within `timeoutMs`.
 */
export function armListenDeadline(
  timeoutMs: number,
  onMissed: () => void,
): void {
  disarmListenDeadline();
  listenDeadline = setTimeout(onMissed, timeoutMs);
  listenDeadline.unref();
}

export function disarmListenDeadline(): void {
  clearTimeout(listenDeadline);
  listenDeadline = undefined;
}
