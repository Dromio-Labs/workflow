export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string") {
    return Number.isFinite(value as number) || kind !== "number";
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isJsonObject(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export function assertJsonValue(value: unknown, label = "value"): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new Error(`${label} must be JSON-serializable.`);
  }
}
