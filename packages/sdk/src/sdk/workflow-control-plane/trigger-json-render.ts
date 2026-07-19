import type {
  TriggerInputDescriptor,
} from "./types.js";

export type TriggerInputJsonRenderField = {
  defaultValue?: unknown;
  description?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type: "checkbox" | "number" | "textarea" | "text";
  valueType?: "boolean" | "json" | "number" | "string";
};

export type TriggerInputJsonRenderForm = {
  fields: TriggerInputJsonRenderField[];
  schemaVersion: 1;
  submitLabel: string;
  type: "form";
};

type ObjectSchemaProjection = {
  properties: Record<string, unknown>;
  required: Set<string>;
};

export function triggerInputJsonRender(input?: TriggerInputDescriptor): unknown | undefined {
  if (input?.jsonRender !== undefined && input.jsonRender !== null) return input.jsonRender;
  return jsonRenderFromJsonSchema(input?.jsonSchema);
}

export function jsonRenderFromJsonSchema(schema: unknown): TriggerInputJsonRenderForm | undefined {
  const objectSchema = objectSchemaProjection(schema);
  if (!objectSchema) return undefined;
  const fields = Object.entries(objectSchema.properties).flatMap(([name, property]) =>
    jsonRenderFieldFromProperty(name, property, objectSchema.required.has(name))
  );
  if (fields.length === 0) return undefined;
  return {
    fields,
    schemaVersion: 1,
    submitLabel: "Run workflow",
    type: "form",
  };
}

function objectSchemaProjection(schema: unknown): ObjectSchemaProjection | undefined {
  if (!isPlainRecord(schema)) return undefined;
  const directProjection = directObjectSchemaProjection(schema);
  const allOf = schema.allOf;
  if (Array.isArray(allOf)) {
    const parts = allOf.flatMap((part): ObjectSchemaProjection[] => {
      const projected = objectSchemaProjection(part);
      return projected ? [projected] : [];
    });
    const merged = mergeObjectSchemaProjections([
      ...(directProjection ? [directProjection] : []),
      ...parts,
    ]);
    if (merged) return merged;
  }
  if (directProjection) return directProjection;

  for (const key of ["oneOf", "anyOf"] as const) {
    const choices = schema[key];
    if (!Array.isArray(choices)) continue;
    for (const choice of choices) {
      const projected = objectSchemaProjection(choice);
      if (projected) return projected;
    }
  }
  return undefined;
}

function directObjectSchemaProjection(schema: Record<string, unknown>): ObjectSchemaProjection | undefined {
  const directProperties = isPlainRecord(schema.properties) ? schema.properties : undefined;
  if (!directProperties || (!schemaTypeIncludes(schema.type, "object") && Object.keys(directProperties).length === 0)) {
    return undefined;
  }
  return {
    properties: directProperties,
    required: requiredSet(schema.required),
  };
}

function mergeObjectSchemaProjections(parts: ObjectSchemaProjection[]): ObjectSchemaProjection | undefined {
  if (parts.length === 0) return undefined;
  return {
    properties: mergeSchemaProperties(parts.map((part) => part.properties)),
    required: new Set(parts.flatMap((part) => [...part.required])),
  };
}

function mergeSchemaProperties(parts: Record<string, unknown>[]) {
  const merged: Record<string, unknown> = {};
  for (const properties of parts) {
    for (const [name, value] of Object.entries(properties)) {
      const current = merged[name];
      merged[name] = isPlainRecord(current) && isPlainRecord(value)
        ? { ...current, ...value }
        : value;
    }
  }
  return merged;
}

function jsonRenderFieldFromProperty(
  name: string,
  property: unknown,
  required: boolean,
): TriggerInputJsonRenderField[] {
  if (!name) return [];
  const record = isPlainRecord(property) ? property : {};
  const type = jsonRenderFieldType(record);
  return [{
    ...schemaDefault(record),
    ...schemaDescription(record),
    ...schemaPlaceholder(record),
    ...schemaValueType(record),
    label: schemaLabel(name, record),
    name,
    required,
    type,
  }];
}

function jsonRenderFieldType(property: Record<string, unknown>): TriggerInputJsonRenderField["type"] {
  const type = schemaType(property.type);
  if (type === "boolean") return "checkbox";
  if (type === "integer" || type === "number") return "number";
  if (type === "array" || type === "object") return "textarea";
  if (property.contentMediaType === "application/json") return "textarea";
  return "text";
}

function schemaValueType(property: Record<string, unknown>): Pick<TriggerInputJsonRenderField, "valueType"> {
  const type = schemaType(property.type);
  if (type === "boolean") return { valueType: "boolean" };
  if (type === "integer" || type === "number") return { valueType: "number" };
  if (type === "array" || type === "object" || property.contentMediaType === "application/json") {
    return { valueType: "json" };
  }
  return { valueType: "string" };
}

function schemaType(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string" && item !== "null");
  return undefined;
}

function schemaTypeIncludes(value: unknown, type: string) {
  if (value === type) return true;
  return Array.isArray(value) && value.includes(type);
}

function schemaLabel(name: string, property: Record<string, unknown>) {
  if (typeof property.title === "string" && property.title.trim()) return property.title.trim();
  return titleFromIdentifier(name);
}

function schemaDescription(property: Record<string, unknown>): Pick<TriggerInputJsonRenderField, "description"> {
  return typeof property.description === "string" && property.description.trim()
    ? { description: property.description.trim() }
    : {};
}

function schemaDefault(property: Record<string, unknown>): Pick<TriggerInputJsonRenderField, "defaultValue"> {
  return Object.hasOwn(property, "default") ? { defaultValue: property.default } : {};
}

function schemaPlaceholder(property: Record<string, unknown>): Pick<TriggerInputJsonRenderField, "placeholder"> {
  if (typeof property.placeholder === "string" && property.placeholder.trim()) {
    return { placeholder: property.placeholder.trim() };
  }
  const example = Array.isArray(property.examples) ? property.examples[0] : property.example;
  const value = stringPlaceholder(example);
  return value === undefined ? {} : { placeholder: value };
}

function stringPlaceholder(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return undefined;
}

function requiredSet(value: unknown) {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(value.filter((item): item is string => typeof item === "string"));
}

function titleFromIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
