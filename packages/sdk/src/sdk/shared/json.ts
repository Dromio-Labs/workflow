export type JsonPrimitive = boolean | null | number | string;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export function toJsonValue(value: unknown): JsonValue {
  return coerceJsonValue(value, new WeakSet<object>());
}

export function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value);
  return json && typeof json === "object" && !Array.isArray(json) ? json : {};
}

function coerceJsonValue(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((child) => coerceJsonValue(child, seen));
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  const object: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined || typeof child === "function" || typeof child === "symbol") {
      continue;
    }
    object[key] = coerceJsonValue(child, seen);
  }
  seen.delete(value);
  return object;
}
