import type {
  Database,
} from "bun:sqlite";
import {
  DatasetSchemaMismatchError,
  DatasetVersionMismatchError,
} from "../dataset-port.js";
import type {
  DatasetCommitCondition,
  DatasetCommitRowsInput,
  DatasetCommitRowsResult,
} from "../dataset-commit-contracts.js";
import type {
  DatasetRegistryEntry,
  DatasetRow,
  DatasetRowsQuery,
  DatasetStoreDefinition,
  DatasetUpsertRowsInput,
  DatasetUpsertRowsResult,
} from "../types.js";

type DatasetRegistryRow = {
  name: string;
  schema_fingerprint: string;
  version: number;
};

class DatasetCommitConditionFailure extends Error {
  constructor(readonly result: Extract<DatasetCommitRowsResult, { committed: false }>) {
    super(`Dataset commit condition ${result.conditionId} did not match.`);
    this.name = "DatasetCommitConditionFailure";
  }
}

export function upsertDatasetRows(
  database: Database,
  input: DatasetUpsertRowsInput,
): DatasetUpsertRowsResult {
  const transaction = database.transaction(() => {
    assertDataset(database, input);
    return writeDatasetRows(database, input);
  });
  return transaction.immediate();
}

export function commitDatasetRows(
  database: Database,
  input: DatasetCommitRowsInput,
): DatasetCommitRowsResult {
  assertUniqueConditionIds(input.conditions);
  const transaction = database.transaction((): DatasetCommitRowsResult => {
    for (const condition of input.conditions) assertDataset(database, condition.definition);
    for (const write of input.writes) assertDataset(database, write);
    for (const condition of input.conditions) {
      const current = readConditionRow(database, condition);
      if (!conditionMatches(condition, current)) {
        throw new DatasetCommitConditionFailure({
          committed: false,
          conditionId: condition.id,
          ...(current ? { current } : {}),
        });
      }
    }
    let inserted = 0;
    let updated = 0;
    for (const write of input.writes) {
      const result = writeDatasetRows(database, write);
      inserted += result.inserted;
      updated += result.updated;
    }
    return { committed: true, inserted, updated };
  });
  try {
    return transaction.immediate();
  } catch (error) {
    if (error instanceof DatasetCommitConditionFailure) return error.result;
    throw error;
  }
}

export function queryDatasetRows(
  database: Database,
  definition: DatasetStoreDefinition,
  query: DatasetRowsQuery = {},
): DatasetRow[] {
  assertDataset(database, definition);
  const table = datasetTableName(definition.name);
  const { clauses, params } = datasetFilter(definition, query.filter ?? {});
  const limit = boundedInteger(query.limit ?? 50, "limit", 0, 1000);
  const offset = boundedInteger(query.offset ?? 0, "offset", 0, Number.MAX_SAFE_INTEGER);
  const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
  const rows = database.query(
    `select row_json from ${table} ${where} order by updated_at desc limit ? offset ?`,
  ).all(...params, limit, offset) as Array<{ row_json: string }>;
  return rows.map((row) => JSON.parse(row.row_json) as DatasetRow);
}

export function countDatasetRows(database: Database, definition: DatasetStoreDefinition): number {
  assertDataset(database, definition);
  const row = database.query(
    `select count(*) as count from ${datasetTableName(definition.name)}`,
  ).get() as { count: number };
  return Number(row.count);
}

export function datasetFreshness(database: Database, definition: DatasetStoreDefinition): string | undefined {
  assertDataset(database, definition);
  const row = database.query(
    `select max(updated_at) as freshness from ${datasetTableName(definition.name)}`,
  ).get() as { freshness: string | null };
  return row.freshness ?? undefined;
}

export function listDatasets(database: Database): DatasetRegistryEntry[] {
  const rows = database.query(
    "select name, version, schema_fingerprint from dataset_registry order by name asc",
  ).all() as DatasetRegistryRow[];
  return rows.map((row) => {
    const table = datasetTableName(row.name);
    const count = database.query(`select count(*) as count from ${table}`).get() as { count: number };
    const freshness = database.query(`select max(updated_at) as freshness from ${table}`).get() as {
      freshness: string | null;
    };
    return {
      ...(freshness.freshness ? { freshness: freshness.freshness } : {}),
      name: row.name,
      rowCount: Number(count.count),
      version: Number(row.version),
    };
  });
}

function assertDataset(database: Database, definition: DatasetStoreDefinition): void {
  validateDatasetIdentifiers(definition);
  const existing = database.query(
    "select name, version, schema_fingerprint from dataset_registry where name = ?",
  ).get(definition.name) as DatasetRegistryRow | null;
  if (existing) {
    if (Number(existing.version) !== definition.version) {
      throw new DatasetVersionMismatchError(definition.name, definition.version, Number(existing.version));
    }
    if (existing.schema_fingerprint !== definition.schemaFingerprint) {
      throw new DatasetSchemaMismatchError(definition.name);
    }
  } else {
    database.run(
      "insert into dataset_registry (name, version, schema_fingerprint, created_at) values (?, ?, ?, ?)",
      [definition.name, definition.version, definition.schemaFingerprint, new Date().toISOString()],
    );
  }
  ensureDatasetTable(database, definition);
}

function writeDatasetRows(
  database: Database,
  input: DatasetUpsertRowsInput,
): DatasetUpsertRowsResult {
  if (input.rows.length === 0) return { inserted: 0, updated: 0 };
  const table = datasetTableName(input.name);
  const keyColumns = input.key.map(quoteIdentifier);
  const keyPredicate = keyColumns.map((column) => `${column} = ?`).join(" and ");
  let inserted = 0;
  let updated = 0;
  for (const row of input.rows) {
    const keyValues = input.key.map((field) => encodeKeyValue(row[field]));
    const existing = database.query(
      `select rowid from ${table} where ${keyPredicate} limit 1`,
    ).get(...keyValues) as { rowid: number } | null;
    const now = new Date().toISOString();
    if (existing) {
      database.run(
        `update ${table} set row_json = ?, updated_at = ? where rowid = ?`,
        [JSON.stringify(row), now, existing.rowid],
      );
      updated += 1;
    } else {
      database.run(
        `insert into ${table} (${["row_json", ...keyColumns, "created_at", "updated_at"].join(", ")})
         values (${["?", ...input.key.map(() => "?"), "?", "?"].join(", ")})`,
        [JSON.stringify(row), ...keyValues, now, now],
      );
      inserted += 1;
    }
  }
  return { inserted, updated };
}

function readConditionRow(
  database: Database,
  condition: DatasetCommitCondition,
): DatasetRow | undefined {
  const expectedFields = [...condition.definition.key].sort();
  const suppliedFields = Object.keys(condition.key).sort();
  if (
    expectedFields.length !== suppliedFields.length
    || expectedFields.some((field, index) => suppliedFields[index] !== field)
  ) {
    throw new Error(
      `Dataset condition ${condition.id} must supply the complete composite key for ${condition.definition.name}.`,
    );
  }
  const keyPredicate = condition.definition.key
    .map((field) => `${quoteIdentifier(field)} = ?`)
    .join(" and ");
  const keyValues = condition.definition.key.map((field) =>
    encodeKeyValue(condition.key[field])
  );
  const row = database.query(
    `select row_json from ${datasetTableName(condition.definition.name)}
     where ${keyPredicate} limit 1`,
  ).get(...keyValues) as { row_json: string } | null;
  return row ? JSON.parse(row.row_json) as DatasetRow : undefined;
}

function conditionMatches(
  condition: DatasetCommitCondition,
  current: DatasetRow | undefined,
): boolean {
  if (condition.match.kind === "absent") return current === undefined;
  return current !== undefined
    && jsonValuesEqual(current[condition.match.field], condition.match.equals);
}

function assertUniqueConditionIds(conditions: readonly DatasetCommitCondition[]): void {
  const ids = new Set<string>();
  for (const condition of conditions) {
    if (!condition.id.trim()) throw new Error("Dataset commit condition IDs must not be empty.");
    if (ids.has(condition.id)) {
      throw new Error(`Dataset commit condition ID is duplicated: ${condition.id}.`);
    }
    ids.add(condition.id);
  }
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && jsonValuesEqual(leftRecord[key], rightRecord[key])
    );
}

function ensureDatasetTable(database: Database, definition: DatasetStoreDefinition): void {
  const table = datasetTableName(definition.name);
  const keyColumns = definition.key.map((field) => `${quoteIdentifier(field)} text not null`);
  database.run(`create table if not exists ${table} (
    row_json text not null,
    ${keyColumns.join(",\n    ")},
    created_at text not null,
    updated_at text not null
  )`);
  database.run(
    `create unique index if not exists ${quoteIdentifier(`dataset_${definition.name}_key_unique`)}
     on ${table} (${definition.key.map(quoteIdentifier).join(", ")})`,
  );
  database.run(
    `create index if not exists ${quoteIdentifier(`dataset_${definition.name}_updated_idx`)}
     on ${table} (updated_at desc)`,
  );
}

function datasetFilter(
  definition: DatasetStoreDefinition,
  filter: Record<string, unknown>,
): { clauses: string[]; params: string[] } {
  const allowed = new Set(definition.key);
  const clauses: string[] = [];
  const params: string[] = [];
  for (const [field, value] of Object.entries(filter)) {
    if (!allowed.has(field)) throw new Error(`Dataset ${definition.name} filter is not a key field: ${field}.`);
    clauses.push(`${quoteIdentifier(field)} = ?`);
    params.push(encodeKeyValue(value));
  }
  return { clauses, params };
}

function validateDatasetIdentifiers(definition: DatasetStoreDefinition): void {
  if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(definition.name)) {
    throw new Error(`Dataset name is not safe for sqlite table creation: ${definition.name}.`);
  }
  if (definition.key.length === 0) throw new Error(`Dataset ${definition.name} must define at least one key field.`);
  for (const field of definition.key) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field) || reservedDatasetColumns.has(field)) {
      throw new Error(`Dataset ${definition.name} key field is not safe for sqlite column creation: ${field}.`);
    }
  }
}

function datasetTableName(name: string): string {
  return quoteIdentifier(`dataset_${name}`);
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(identifier)) {
    throw new Error(`Unsafe sqlite identifier: ${identifier}.`);
  }
  return `"${identifier}"`;
}

function encodeKeyValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  throw new Error("Dataset key values must be JSON primitives.");
}

function boundedInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Dataset query ${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

const reservedDatasetColumns = new Set(["created_at", "row_json", "updated_at"]);
