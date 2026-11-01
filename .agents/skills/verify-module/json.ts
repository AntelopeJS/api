import type { CallRequest } from "@antelopejs/tooling-configs/verify";

/** A JSON value as the harness passes it to and reads it from the module. */
export type Json = NonNullable<CallRequest["args"]>[number];

/** A JSON object. */
export interface JsonRecord {
  [key: string]: Json;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a JSON string. */
export function isString(value: Json | undefined): value is string {
  return typeof value === "string";
}

/** True for a JSON number. */
export function isNumber(value: Json | undefined): value is number {
  return typeof value === "number";
}

function isIndex(step: string | number): step is number {
  return typeof step === "number";
}

/** The number at `key` of a JSON object, or `NaN`. */
export function numberAt(value: Json | undefined, key: string): number {
  const found = pick(value, key);
  return isNumber(found) ? found : Number.NaN;
}

/** The object `value` holds, or an empty object. */
export function recordOf(value: Json | undefined): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

/** The string `value` holds, or an empty string. */
export function text(value: Json | undefined): string {
  return isString(value) ? value : "";
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function isJson(value: unknown): value is Json {
  if (isScalar(value)) return true;
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
}

function isJsonRecord(value: Json | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `value` down the given keys and indexes; `undefined` when a step is missing. */
export function pick(value: Json | undefined, ...path: (string | number)[]): Json | undefined {
  let current = value;
  for (const step of path) {
    if (isIndex(step)) {
      current = Array.isArray(current) ? current[step] : undefined;
    } else {
      current = isJsonRecord(current) && Object.keys(current).includes(step) ? current[step] : undefined;
    }
  }
  return current;
}

/** The value with object keys in sorted order, so two values compare equal whatever order their keys were written in. */
export function canonical(value: Json | undefined): Json {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (isJsonRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** Parses JSON text; an empty text reads as `null`, and text that is not JSON as `undefined`. */
export function parseJson(source: string): Json | undefined {
  if (source === "") return null;
  try {
    const parsed: unknown = JSON.parse(source);
    return isJson(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
