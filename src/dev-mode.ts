import { Logging } from "@antelopejs/interface-core/logging";
import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";

const DEFAULT_DEV_MODE = false;

let devMode = DEFAULT_DEV_MODE;

/**
 * Tells whether the module runs under a development runtime.
 *
 * The value is cached so that synchronous handlers can read it.
 */
export function isDevMode(): boolean {
  return devMode;
}

/**
 * Overrides the cached development runtime flag.
 */
export function setDevMode(enabled: boolean): void {
  devMode = enabled;
}

/**
 * Reads the runtime information once and caches its development flag.
 */
export async function resolveDevMode(): Promise<void> {
  try {
    const runtimeInfo = await GetRuntimeInfo();
    setDevMode(runtimeInfo.dev);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logging.Warn(`Unable to resolve the development runtime flag: ${message}`);
    setDevMode(DEFAULT_DEV_MODE);
  }
}
