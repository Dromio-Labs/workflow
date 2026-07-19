export function jsonSchemaCompatible(source: unknown, target: unknown): boolean {
  return stableJson(source) === stableJson(target) || jsonSchemaAssignable(source, target);
}

function jsonSchemaAssignable(source: unknown, target: unknown): boolean {
  if (stableJson(source) === stableJson(target)) return true;
  const sourceAllOf = jsonSchemaArray(source, "allOf");
  if (sourceAllOf.length > 0) {
    return sourceAllOf.some((sourceBranch) => jsonSchemaAssignable(sourceBranch, target));
  }
  const targetAllOf = jsonSchemaArray(target, "allOf");
  if (targetAllOf.length > 0) {
    return targetAllOf.every((targetBranch) => jsonSchemaAssignable(source, targetBranch));
  }
  const sourceVariants = jsonSchemaVariants(source);
  if (sourceVariants.length > 0) {
    return sourceVariants.every((sourceVariant) => jsonSchemaAssignable(sourceVariant, target));
  }
  const targetVariants = jsonSchemaVariants(target);
  if (targetVariants.length > 0) {
    return targetVariants.some((targetVariant) => jsonSchemaAssignable(source, targetVariant));
  }

  if (!jsonSchemaLiteralSetAssignable(source, target)) return false;
  const sourceTypes = jsonSchemaTypes(source);
  const targetTypes = jsonSchemaTypes(target);
  if (targetTypes.length > 0) {
    if (sourceTypes.length === 0) return false;
    if (!sourceTypes.every((type) => targetTypes.includes(type))) return false;
  }
  if (hasObjectConstraints(target)) {
    if (sourceTypes.length > 0 && !sourceTypes.includes("object")) return false;
    if (!objectPropertiesAssignable(source, target)) return false;
  }
  if (hasStringConstraints(target)) {
    if (sourceTypes.length > 0 && !sourceTypes.includes("string")) return false;
    if (!stringConstraintsAssignable(source, target)) return false;
  }
  if (hasNumberConstraints(target)) {
    if (sourceTypes.length > 0 && !sourceTypes.some((type) => type === "integer" || type === "number")) return false;
    if (!numberConstraintsAssignable(source, target)) return false;
  }
  if (hasArrayConstraints(target)) {
    if (sourceTypes.length > 0 && !sourceTypes.includes("array")) return false;
    if (!arrayItemsAssignable(source, target)) return false;
  }
  return true;
}

function objectPropertiesAssignable(source: unknown, target: unknown): boolean {
  const sourceProperties = jsonSchemaProperties(source);
  const targetProperties = jsonSchemaProperties(target);
  const targetPropertyEntries = Object.entries(targetProperties ?? {});
  const sourceRequired = new Set(jsonSchemaRequired(source));
  for (const key of jsonSchemaRequired(target)) {
    if (!sourceRequired.has(key)) return false;
  }
  if (targetPropertyEntries.length === 0) return true;
  if (!sourceProperties) return false;
  for (const [key, targetProperty] of targetPropertyEntries) {
    const sourceProperty = sourceProperties[key];
    if (!sourceProperty) return false;
    if (!jsonSchemaAssignable(sourceProperty, targetProperty)) {
      return false;
    }
  }
  if (!additionalPropertiesAssignable(source, target)) return false;
  if (!numberKeywordAssignable(source, target, "minProperties", (sourceValue, targetValue) => sourceValue >= targetValue)) return false;
  if (!numberKeywordAssignable(source, target, "maxProperties", (sourceValue, targetValue) => sourceValue <= targetValue)) return false;
  return true;
}

function arrayItemsAssignable(source: unknown, target: unknown): boolean {
  const targetItems = jsonSchemaItems(target);
  if (targetItems) {
    const sourceItems = jsonSchemaItems(source);
    if (!sourceItems) return false;
    if (!jsonSchemaAssignable(sourceItems, targetItems)) return false;
  }
  if (!numberKeywordAssignable(source, target, "minItems", (sourceValue, targetValue) => sourceValue >= targetValue)) return false;
  if (!numberKeywordAssignable(source, target, "maxItems", (sourceValue, targetValue) => sourceValue <= targetValue)) return false;
  if (booleanKeyword(target, "uniqueItems") === true && booleanKeyword(source, "uniqueItems") !== true) return false;
  return true;
}

function jsonSchemaLiteralSetAssignable(source: unknown, target: unknown) {
  const targetValues = jsonSchemaLiteralValues(target);
  if (targetValues.length === 0) return true;
  const sourceValues = jsonSchemaLiteralValues(source);
  if (sourceValues.length === 0) return false;
  return sourceValues.every((sourceValue) =>
    targetValues.some((targetValue) => stableJson(targetValue) === stableJson(sourceValue))
  );
}

function hasObjectConstraints(schema: unknown) {
  return isRecord(schema) && (
    isRecord(schema.properties) ||
    Array.isArray(schema.required) ||
    "additionalProperties" in schema ||
    typeof schema.minProperties === "number" ||
    typeof schema.maxProperties === "number"
  );
}

function hasArrayConstraints(schema: unknown) {
  return isRecord(schema) && (
    Boolean(schema.items) ||
    typeof schema.minItems === "number" ||
    typeof schema.maxItems === "number" ||
    typeof schema.uniqueItems === "boolean"
  );
}

function hasStringConstraints(schema: unknown) {
  return isRecord(schema) && (
    typeof schema.minLength === "number" ||
    typeof schema.maxLength === "number" ||
    typeof schema.pattern === "string" ||
    typeof schema.format === "string"
  );
}

function hasNumberConstraints(schema: unknown) {
  return isRecord(schema) && (
    typeof schema.minimum === "number" ||
    typeof schema.maximum === "number" ||
    typeof schema.exclusiveMinimum === "number" ||
    typeof schema.exclusiveMaximum === "number" ||
    typeof schema.multipleOf === "number"
  );
}

function stringConstraintsAssignable(source: unknown, target: unknown): boolean {
  if (!numberKeywordAssignable(source, target, "minLength", (sourceValue, targetValue) => sourceValue >= targetValue)) return false;
  if (!numberKeywordAssignable(source, target, "maxLength", (sourceValue, targetValue) => sourceValue <= targetValue)) return false;
  if (!stringPatternAssignable(source, target)) return false;
  const targetFormat = stringKeyword(target, "format");
  if (targetFormat && stringKeyword(source, "format") !== targetFormat) {
    return literalValuesSatisfy(source, (value) =>
      typeof value === "string" && stringMatchesFormat(value, targetFormat)
    );
  }
  return true;
}

function stringPatternAssignable(source: unknown, target: unknown): boolean {
  const targetPattern = stringKeyword(target, "pattern");
  if (!targetPattern) return true;
  const sourcePattern = stringKeyword(source, "pattern");
  if (sourcePattern === targetPattern) return true;
  return literalValuesSatisfy(source, (value) =>
    typeof value === "string" && new RegExp(targetPattern).test(value)
  );
}

function numberConstraintsAssignable(source: unknown, target: unknown): boolean {
  if (!numberLowerBoundAssignable(source, target)) return false;
  if (!numberUpperBoundAssignable(source, target)) return false;
  const targetMultipleOf = numberKeyword(target, "multipleOf");
  if (targetMultipleOf !== undefined) {
    const sourceMultipleOf = numberKeyword(source, "multipleOf");
    if (sourceMultipleOf === undefined || sourceMultipleOf % targetMultipleOf !== 0) return false;
  }
  return true;
}

function additionalPropertiesAssignable(source: unknown, target: unknown): boolean {
  if (!isRecord(target)) return true;
  const targetAdditional = target.additionalProperties;
  if (targetAdditional === undefined || targetAdditional === true) return true;
  if (!isRecord(source)) return false;
  const sourceAdditional = source.additionalProperties;
  const sourceProperties = new Set(Object.keys(jsonSchemaProperties(source) ?? {}));
  const targetProperties = new Set(Object.keys(jsonSchemaProperties(target) ?? {}));
  if (targetAdditional === false) {
    if (sourceAdditional !== false) return false;
    for (const key of sourceProperties) {
      if (!targetProperties.has(key)) return false;
    }
    return true;
  }
  if (sourceAdditional === false) {
    for (const key of sourceProperties) {
      if (!targetProperties.has(key)) return false;
    }
    return true;
  }
  if (sourceAdditional === undefined || sourceAdditional === true) return false;
  return jsonSchemaAssignable(sourceAdditional, targetAdditional);
}

function jsonSchemaTypes(schema: unknown): string[] {
  if (!isRecord(schema)) return [];
  if (typeof schema.type === "string") return [schema.type];
  if (Array.isArray(schema.type)) {
    return schema.type.filter((item): item is string => typeof item === "string");
  }
  const variants = [...jsonSchemaArray(schema, "anyOf"), ...jsonSchemaArray(schema, "oneOf")];
  return [...new Set(variants.flatMap(jsonSchemaTypes))];
}

function jsonSchemaVariants(schema: unknown): unknown[] {
  return [
    ...jsonSchemaArray(schema, "anyOf"),
    ...jsonSchemaArray(schema, "oneOf"),
  ];
}

function jsonSchemaProperties(schema: unknown): Record<string, unknown> | undefined {
  if (!isRecord(schema) || !isRecord(schema.properties)) return undefined;
  return schema.properties;
}

function jsonSchemaRequired(schema: unknown): string[] {
  if (!isRecord(schema) || !Array.isArray(schema.required)) return [];
  return schema.required.filter((item): item is string => typeof item === "string");
}

function jsonSchemaItems(schema: unknown): unknown | undefined {
  if (!isRecord(schema) || !schema.items || Array.isArray(schema.items)) return undefined;
  return schema.items;
}

function jsonSchemaLiteralValues(schema: unknown): unknown[] {
  if (!isRecord(schema)) return [];
  if ("const" in schema) return [schema.const];
  if (Array.isArray(schema.enum)) return schema.enum;
  return [];
}

function literalValuesSatisfy(
  schema: unknown,
  predicate: (value: unknown) => boolean,
): boolean {
  const values = jsonSchemaLiteralValues(schema);
  return values.length > 0 && values.every(predicate);
}

function numberLowerBoundAssignable(source: unknown, target: unknown): boolean {
  const sourceBound = lowerNumberBound(source);
  const targetBound = lowerNumberBound(target);
  if (!targetBound) return true;
  if (!sourceBound) return false;
  if (sourceBound.value > targetBound.value) return true;
  if (sourceBound.value < targetBound.value) return false;
  return targetBound.exclusive ? sourceBound.exclusive : true;
}

function numberUpperBoundAssignable(source: unknown, target: unknown): boolean {
  const sourceBound = upperNumberBound(source);
  const targetBound = upperNumberBound(target);
  if (!targetBound) return true;
  if (!sourceBound) return false;
  if (sourceBound.value < targetBound.value) return true;
  if (sourceBound.value > targetBound.value) return false;
  return targetBound.exclusive ? sourceBound.exclusive : true;
}

function lowerNumberBound(schema: unknown) {
  const exclusiveMinimum = numberKeyword(schema, "exclusiveMinimum");
  if (exclusiveMinimum !== undefined) {
    return {
      exclusive: true,
      value: exclusiveMinimum,
    };
  }
  const minimum = numberKeyword(schema, "minimum");
  if (minimum !== undefined) {
    return {
      exclusive: false,
      value: minimum,
    };
  }
  return undefined;
}

function upperNumberBound(schema: unknown) {
  const exclusiveMaximum = numberKeyword(schema, "exclusiveMaximum");
  if (exclusiveMaximum !== undefined) {
    return {
      exclusive: true,
      value: exclusiveMaximum,
    };
  }
  const maximum = numberKeyword(schema, "maximum");
  if (maximum !== undefined) {
    return {
      exclusive: false,
      value: maximum,
    };
  }
  return undefined;
}

function numberKeywordAssignable(
  source: unknown,
  target: unknown,
  key: string,
  compare: (sourceValue: number, targetValue: number) => boolean,
) {
  const targetValue = numberKeyword(target, key);
  if (targetValue === undefined) return true;
  const sourceValue = numberKeyword(source, key);
  return sourceValue !== undefined && compare(sourceValue, targetValue);
}

function numberKeyword(schema: unknown, key: string): number | undefined {
  if (!isRecord(schema)) return undefined;
  const value = schema[key];
  return typeof value === "number" ? value : undefined;
}

function booleanKeyword(schema: unknown, key: string): boolean | undefined {
  if (!isRecord(schema)) return undefined;
  const value = schema[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringKeyword(schema: unknown, key: string): string | undefined {
  if (!isRecord(schema)) return undefined;
  const value = schema[key];
  return typeof value === "string" ? value : undefined;
}

function stringMatchesFormat(value: string, format: string): boolean {
  if (format === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  if (format === "uri" || format === "url") {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
  if (format === "uuid") {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
  }
  if (format === "date") {
    return validDateString(value);
  }
  if (format === "date-time") {
    return validDateTimeString(value);
  }
  if (format === "time") {
    return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?$/.test(value);
  }
  if (format === "hostname") {
    return value.length <= 253 && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(value);
  }
  if (format === "ipv4") {
    return value.split(".").length === 4 && value.split(".").every((part) => {
      if (!/^\d+$/.test(part)) return false;
      const octet = Number(part);
      return octet >= 0 && octet <= 255 && String(octet) === part;
    });
  }
  return false;
}

function validDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  return validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function validDateTimeString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  return validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonSchemaArray(schema: unknown, key: "allOf" | "anyOf" | "oneOf"): unknown[] {
  if (!isRecord(schema)) return [];
  const value = schema[key];
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
