import type { DromioTriggerOccurrenceV1 } from "@dromio/protocols";
import type { TriggerDefinition, TriggerDispatchReceipt, TriggerStore } from "./types.js";

type SqlValue = string | number | null;
export interface TriggerPostgresPool { query<Row extends object = Record<string, never>>(text: string, values?: readonly SqlValue[]): Promise<{ readonly rows: readonly Row[] }>; }
const migration = `
CREATE TABLE IF NOT EXISTS trigger_definitions (id TEXT PRIMARY KEY, resource_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trigger_occurrences (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, application_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, resource_json TEXT NOT NULL, receipt_json TEXT NOT NULL, UNIQUE(tenant_id,application_id,idempotency_key));
`;

export class PostgresTriggerStore implements TriggerStore {
  constructor(private readonly pool: TriggerPostgresPool) {}
  async migrate(): Promise<void> { await this.pool.query(migration); }
  async putDefinition(value: TriggerDefinition): Promise<void> { await this.pool.query("INSERT INTO trigger_definitions (id,resource_json) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET resource_json=EXCLUDED.resource_json", [value.id, JSON.stringify(value)]); }
  async getDefinition(id: string): Promise<TriggerDefinition | undefined> { return first(await this.pool.query<JsonRow>("SELECT resource_json FROM trigger_definitions WHERE id=$1", [id])); }
  async getReceipt(tenantId: string, applicationId: string, key: string): Promise<TriggerDispatchReceipt | undefined> { return first(await this.pool.query<JsonRow>("SELECT receipt_json AS resource_json FROM trigger_occurrences WHERE tenant_id=$1 AND application_id=$2 AND idempotency_key=$3", [tenantId, applicationId, key])); }
  async putOccurrenceAndReceipt(value: DromioTriggerOccurrenceV1, receipt: TriggerDispatchReceipt): Promise<void> { await this.pool.query("INSERT INTO trigger_occurrences (id,tenant_id,application_id,idempotency_key,resource_json,receipt_json) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,application_id,idempotency_key) DO NOTHING", [value.id, value.tenantId, value.applicationId, value.idempotencyKey, JSON.stringify(value), JSON.stringify(receipt)]); }
}
interface JsonRow { readonly resource_json: string; }
function first<Value>(result: { readonly rows: readonly JsonRow[] }): Value | undefined { const row = result.rows[0]; return row ? JSON.parse(row.resource_json) as Value : undefined; }
