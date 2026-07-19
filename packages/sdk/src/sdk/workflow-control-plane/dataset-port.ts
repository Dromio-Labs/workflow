import {
  createHash,
} from "node:crypto";
import {
  jsonSchemaFromContractSource,
  normalizeOperationContract,
} from "../core/prompted-operation/index.js";
import {
  toJsonObject,
  type JsonPrimitive,
  type JsonValue,
} from "../shared/json.js";
import type {
  DatasetDefinition,
  DatasetRowOf,
} from "../product/datasets/index.js";
import type {
  DatasetRow,
  DatasetRowsQuery,
  DatasetStoreDefinition,
  DatasetUpsertRowsResult,
  WorkflowRuntimeStore,
} from "./types.js";
export {
  DatasetSchemaMismatchError,
  DatasetVersionMismatchError,
} from "./dataset-errors.js";

export type DatasetHandle<TDefinition extends DatasetDefinition> = {
  readonly definition: TDefinition;
  count(): Promise<number>;
  freshness(): Promise<string | undefined>;
  query(query?: DatasetRowsQuery): Promise<DatasetRowOf<TDefinition>[]>;
  upsert(rows: readonly DatasetRowOf<TDefinition>[]): Promise<DatasetUpsertRowsResult>;
};

export type DatasetPort<TDefinitions extends readonly DatasetDefinition[]> = {
  readonly datasets: {
    readonly [TDefinition in TDefinitions[number] as TDefinition["name"]]: DatasetHandle<TDefinition>;
  };
};

export type CreateDatasetPortInput<TDefinitions extends readonly DatasetDefinition[]> = {
  readonly definitions: TDefinitions;
  readonly runtimeStore: WorkflowRuntimeStore;
};

export class DatasetRuntimeStoreUnsupportedError extends Error {
  constructor(readonly capability: string) {
    super(`Workflow runtime store does not support dataset ${capability}.`);
    this.name = "DatasetRuntimeStoreUnsupportedError";
  }
}

export class DatasetRowValidationError extends Error {
  constructor(
    readonly datasetName: string,
    readonly issues: readonly string[],
  ) {
    super(`Dataset ${datasetName} row validation failed: ${issues.join("; ")}`);
    this.name = "DatasetRowValidationError";
  }
}

/** Creates a typed dataset port backed by the configured runtime store. */
export function createDatasetPort<const TDefinitions extends readonly DatasetDefinition[]>(
  input: CreateDatasetPortInput<TDefinitions>,
): DatasetPort<TDefinitions> {
  const registration = input.definitions.map((definition) =>
    maybePromise(registerDataset(input.runtimeStore, definition))
  );
  const handles = Object.fromEntries(input.definitions.map((definition) => [
    definition.name,
    createDatasetHandle(input.runtimeStore, definition, registration),
  ]));
  return { datasets: handles } as DatasetPort<TDefinitions>;
}

export function datasetStoreDefinition(definition: DatasetDefinition): DatasetStoreDefinition {
  return {
    key: [...definition.key],
    name: definition.name,
    schemaFingerprint: datasetSchemaFingerprint(definition),
    version: definition.version,
  };
}

function createDatasetHandle<TDefinition extends DatasetDefinition>(
  runtimeStore: WorkflowRuntimeStore,
  definition: TDefinition,
  registration: readonly Promise<void>[],
): DatasetHandle<TDefinition> {
  const storeDefinition = datasetStoreDefinition(definition);
  return {
    definition,
    async count() {
      await waitForRegistration(registration);
      return requireDatasetCapability(runtimeStore.countDatasetRows, "count rows").call(runtimeStore, storeDefinition);
    },
    async freshness() {
      await waitForRegistration(registration);
      return requireDatasetCapability(runtimeStore.datasetFreshness, "freshness").call(runtimeStore, storeDefinition);
    },
    async query(query) {
      await waitForRegistration(registration);
      const rows = await requireDatasetCapability(runtimeStore.queryDatasetRows, "query rows")
        .call(runtimeStore, storeDefinition, query);
      return rows as DatasetRowOf<TDefinition>[];
    },
    async upsert(rows) {
      await waitForRegistration(registration);
      const parsedRows = validateRows(definition, rows);
      return requireDatasetCapability(runtimeStore.upsertDatasetRows, "upsert rows").call(runtimeStore, {
        ...storeDefinition,
        rows: parsedRows,
      });
    },
  };
}

function registerDataset(
  runtimeStore: WorkflowRuntimeStore,
  definition: DatasetDefinition,
): Promise<DatasetUpsertRowsResult> | DatasetUpsertRowsResult {
  return requireDatasetCapability(runtimeStore.upsertDatasetRows, "register definitions").call(runtimeStore, {
    ...datasetStoreDefinition(definition),
    rows: [],
  });
}

function validateRows(definition: DatasetDefinition, rows: readonly unknown[]): DatasetRow[] {
  const contract = normalizeOperationContract(`dataset.${definition.name}.row`, definition.schema);
  const parsedRows: DatasetRow[] = [];
  const issues: string[] = [];
  rows.forEach((row, index) => {
    const result = contract.safeParse(row);
    if (!result.success) {
      issues.push(...result.issues.map((issue) =>
        `row ${index}: ${issue.path?.length ? `${issue.path.map(String).join(".")}: ` : ""}${issue.message}`
      ));
      return;
    }
    if (!isRecord(result.data)) {
      issues.push(`row ${index}: dataset rows must be objects`);
      return;
    }
    const jsonRow = toJsonObject(result.data);
    for (const field of definition.key) {
      if (!isKeyValue(jsonRow[field])) {
        issues.push(`row ${index}: key field ${field} must be a JSON primitive`);
      }
    }
    parsedRows.push(jsonRow);
  });
  if (issues.length > 0) throw new DatasetRowValidationError(definition.name, issues);
  return parsedRows;
}

function datasetSchemaFingerprint(definition: DatasetDefinition): string {
  const jsonSchema = jsonSchemaFromContractSource(definition.schema) ?? { id: definition.schema.id ?? null };
  return createHash("sha256")
    .update(stableStringify(jsonSchema))
    .digest("hex");
}

function stableStringify(value: JsonValue | unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(",")}}`;
}

function requireDatasetCapability<TCapability>(
  capability: TCapability | undefined,
  name: string,
): NonNullable<TCapability> {
  if (!capability) throw new DatasetRuntimeStoreUnsupportedError(name);
  return capability;
}

function maybePromise(
  value: Promise<DatasetUpsertRowsResult> | DatasetUpsertRowsResult | void,
): Promise<void> {
  return Promise.resolve(value).then(() => undefined);
}

async function waitForRegistration(registration: readonly Promise<void>[]): Promise<void> {
  await Promise.all(registration);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isKeyValue(value: JsonValue | undefined): value is JsonPrimitive {
  return value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}
