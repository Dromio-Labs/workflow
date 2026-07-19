import {
  jsonSchemaFromContractSource,
  type InferOperationContractSource,
  type OperationContractSourceLike,
} from "../../core/prompted-operation/index.js";

export type DatasetDefinition<
  TName extends string = string,
  TSchema extends OperationContractSourceLike = OperationContractSourceLike,
  TKey extends readonly string[] = readonly string[],
> = {
  readonly key: TKey;
  readonly name: TName;
  readonly schema: TSchema;
  readonly version: number;
};

export type DatasetRowOf<TDefinition extends DatasetDefinition> =
  InferOperationContractSource<TDefinition["schema"]>;

export type CreateDatasetInput<
  TName extends string,
  TSchema extends OperationContractSourceLike,
  TKey extends readonly string[],
> = {
  readonly key: TKey;
  readonly name: TName;
  readonly schema: TSchema;
  readonly version?: number;
};

export class DatasetDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetDefinitionError";
  }
}

/** Defines a versioned dataset contract with schema-checked key fields. */
export function createDataset<
  const TName extends string,
  TSchema extends OperationContractSourceLike,
  const TKey extends readonly string[],
>(input: CreateDatasetInput<TName, TSchema, TKey>): DatasetDefinition<TName, TSchema, TKey> {
  validateDatasetName(input.name);
  validateDatasetVersion(input.version ?? 1, input.name);
  validateDatasetKey(input.key, input.name);
  assertIntrospectableKeyFields(input.name, input.schema, input.key);
  return {
    key: input.key,
    name: input.name,
    schema: input.schema,
    version: input.version ?? 1,
  };
}

export function validateDatasetName(name: string): void {
  if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(name)) {
    throw new DatasetDefinitionError(
      `Dataset name must be non-empty and kebab/snake-safe: ${name || "<empty>"}.`,
    );
  }
}

export function validateDatasetColumnName(name: string, datasetName: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || reservedDatasetColumns.has(name)) {
    throw new DatasetDefinitionError(`Dataset ${datasetName} key field is not a safe row column: ${name}.`);
  }
}

function validateDatasetVersion(version: number, name: string): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new DatasetDefinitionError(`Dataset ${name} version must be a positive integer.`);
  }
}

function validateDatasetKey(key: readonly string[], name: string): void {
  if (key.length === 0) {
    throw new DatasetDefinitionError(`Dataset ${name} must define at least one key field.`);
  }
  const seen = new Set<string>();
  for (const field of key) {
    validateDatasetColumnName(field, name);
    if (seen.has(field)) {
      throw new DatasetDefinitionError(`Dataset ${name} key field is duplicated: ${field}.`);
    }
    seen.add(field);
  }
}

function assertIntrospectableKeyFields(
  name: string,
  schema: OperationContractSourceLike,
  key: readonly string[],
): void {
  const properties = introspectObjectProperties(schema);
  if (!properties) return;
  for (const field of key) {
    if (!properties.has(field)) {
      throw new DatasetDefinitionError(`Dataset ${name} key field is not present in the row schema: ${field}.`);
    }
  }
}

function introspectObjectProperties(schema: OperationContractSourceLike): Set<string> | undefined {
  const jsonSchema = "jsonSchema" in schema && schema.jsonSchema !== undefined
    ? schema.jsonSchema
    : jsonSchemaFromContractSource(schema);
  if (!jsonSchema || typeof jsonSchema !== "object" || Array.isArray(jsonSchema)) return undefined;
  const properties = (jsonSchema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return undefined;
  return new Set(Object.keys(properties));
}

const reservedDatasetColumns = new Set(["created_at", "row_json", "updated_at"]);
