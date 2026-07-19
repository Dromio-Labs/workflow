import { Database } from "bun:sqlite";
import type { DromioTriggerOccurrenceV1 } from "@dromio/protocols";
import type { TriggerDefinition, TriggerDispatchReceipt, TriggerStore } from "./types.js";

const migration = `
CREATE TABLE IF NOT EXISTS trigger_definitions (id TEXT PRIMARY KEY, resource_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trigger_occurrences (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, application_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, resource_json TEXT NOT NULL, receipt_json TEXT NOT NULL, UNIQUE(tenant_id,application_id,idempotency_key));
`;

export class SqliteTriggerStore implements TriggerStore {
  constructor(private readonly database: Database) { database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;"); database.exec(migration); }
  async putDefinition(value: TriggerDefinition): Promise<void> { this.database.query("INSERT INTO trigger_definitions (id,resource_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET resource_json=excluded.resource_json").run(value.id, JSON.stringify(value)); }
  async getDefinition(id: string): Promise<TriggerDefinition | undefined> { return optional(this.database.query("SELECT resource_json FROM trigger_definitions WHERE id=?").get(id)); }
  async getReceipt(tenantId: string, applicationId: string, key: string): Promise<TriggerDispatchReceipt | undefined> { return optional(this.database.query("SELECT receipt_json AS resource_json FROM trigger_occurrences WHERE tenant_id=? AND application_id=? AND idempotency_key=?").get(tenantId, applicationId, key)); }
  async putOccurrenceAndReceipt(value: DromioTriggerOccurrenceV1, receipt: TriggerDispatchReceipt): Promise<void> { this.database.query("INSERT INTO trigger_occurrences (id,tenant_id,application_id,idempotency_key,resource_json,receipt_json) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,application_id,idempotency_key) DO NOTHING").run(value.id, value.tenantId, value.applicationId, value.idempotencyKey, JSON.stringify(value), JSON.stringify(receipt)); }
}

function optional<Value>(row: unknown): Value | undefined { if (!row || typeof row !== "object" || !("resource_json" in row) || typeof row.resource_json !== "string") return undefined; return JSON.parse(row.resource_json) as Value; }
