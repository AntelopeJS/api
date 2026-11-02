import type { Check } from "@antelopejs/tooling-configs/verify";

import { canonical, type Json } from "./json.ts";

/** A check that two values are the same JSON once their keys are in order; an absent value equals only another absent one. */
export function same(name: string, actual: Json | undefined, expected: Json | undefined): Check {
  const got = actual === undefined ? "<absent>" : JSON.stringify(canonical(actual));
  const want = expected === undefined ? "<absent>" : JSON.stringify(canonical(expected));
  return { name, pass: got === want, detail: `expected ${want}, got ${got}` };
}

/** A check that `text` matches `pattern`. */
export function matches(name: string, text: string, pattern: RegExp): Check {
  return { name, pass: pattern.test(text), detail: `expected ${String(pattern)}, got ${JSON.stringify(text.slice(0, 300))}` };
}

/** A check that `value` is true. */
export function holds(name: string, value: boolean, detail = ""): Check {
  return { name, pass: value, detail };
}
