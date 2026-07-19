import {
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from "../json.js";

export function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (isJsonValue(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  const record = recordValue(value);
  if (record) {
    return Object.fromEntries(
      Object.entries(record)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, jsonValue(entryValue)]),
    );
  }
  return String(value);
}

export function jsonObjectOrUndefined(value: unknown): JsonObject | undefined {
  const json = jsonValue(value);
  return isJsonObject(json) ? json : undefined;
}

export function compactObject<T extends JsonObject>(value: {
  [K in keyof T]: T[K] | undefined;
}): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

export function recordValue(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
