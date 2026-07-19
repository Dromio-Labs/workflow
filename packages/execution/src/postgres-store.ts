import type { ExecutionAttempt, ExecutionRun, ExecutionStore, ExecutionTransaction } from "./types.js";

type SqlValue = string | number | null;
export interface ExecutionPostgresClient { query<Row extends object = Record<string, never>>(text: string, values?: readonly SqlValue[]): Promise<{ readonly rows: readonly Row[] }>; release(): void; }
export interface ExecutionPostgresPool { connect(): Promise<ExecutionPostgresClient>; query(text: string): Promise<unknown>; }

const migration = `
CREATE TABLE IF NOT EXISTS execution_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, application_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, resource_json TEXT NOT NULL, UNIQUE(tenant_id,application_id,idempotency_key));
CREATE TABLE IF NOT EXISTS execution_attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, number INTEGER NOT NULL, resource_json TEXT NOT NULL, UNIQUE(run_id,number));
CREATE TABLE IF NOT EXISTS execution_fencing (run_id TEXT PRIMARY KEY, value INTEGER NOT NULL);
`;

export class PostgresExecutionStore implements ExecutionStore {
  constructor(private readonly pool: ExecutionPostgresPool) {}
  async migrate(): Promise<void> { await this.pool.query(migration); }
  async transaction<Result>(work: (transaction: ExecutionTransaction) => Result): Promise<Result> {
    const client = await this.pool.connect(); await client.query("BEGIN");
    try { await client.query("SELECT pg_advisory_xact_lock(hashtext('dromio_execution'))"); const state = await load(client); const result = work(transactionFor(state)); await persist(client, state); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async listRuns(): Promise<readonly ExecutionRun[]> { const client = await this.pool.connect(); try { return (await client.query<JsonRow>("SELECT resource_json FROM execution_runs ORDER BY id")).rows.map(parse<ExecutionRun>); } finally { client.release(); } }
  async listAttempts(runId: string): Promise<readonly ExecutionAttempt[]> { const client = await this.pool.connect(); try { return (await client.query<JsonRow>("SELECT resource_json FROM execution_attempts WHERE run_id=$1 ORDER BY number", [runId])).rows.map(parse<ExecutionAttempt>); } finally { client.release(); } }
  async purgeThread(threadId: string): Promise<number> { const client = await this.pool.connect(); await client.query("BEGIN"); try { const runs = await client.query<{ id: string }>("SELECT id FROM execution_runs WHERE resource_json::jsonb->'payload'->>'threadId'=$1 FOR UPDATE", [threadId]); for (const row of runs.rows) { await client.query("DELETE FROM execution_attempts WHERE run_id=$1", [row.id]); await client.query("DELETE FROM execution_fencing WHERE run_id=$1", [row.id]); await client.query("DELETE FROM execution_runs WHERE id=$1", [row.id]); } await client.query("COMMIT"); return runs.rows.length; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}

interface State { readonly runs: Map<string, ExecutionRun>; readonly attempts: Map<string, ExecutionAttempt[]>; readonly fencing: Map<string, number>; }
interface JsonRow { readonly resource_json: string; }
async function load(client: ExecutionPostgresClient): Promise<State> { const [runs, attempts, fencing] = await Promise.all([client.query<JsonRow>("SELECT resource_json FROM execution_runs FOR UPDATE"), client.query<JsonRow>("SELECT resource_json FROM execution_attempts FOR UPDATE"), client.query<{ run_id: string; value: number }>("SELECT run_id,value FROM execution_fencing FOR UPDATE")]); const state: State = { runs: new Map(), attempts: new Map(), fencing: new Map(fencing.rows.map((row) => [row.run_id, row.value])) }; for (const row of runs.rows) { const value = parse<ExecutionRun>(row); state.runs.set(value.id, value); } for (const row of attempts.rows) { const value = parse<ExecutionAttempt>(row); const values = state.attempts.get(value.runId) ?? []; values.push(value); state.attempts.set(value.runId, values); } return state; }
function transactionFor(state: State): ExecutionTransaction { return { getRun: (id) => state.runs.get(id), findByIdempotency: (tenantId, applicationId, key) => [...state.runs.values()].find((value) => value.tenantId === tenantId && value.applicationId === applicationId && value.idempotencyKey === key), listRuns: () => [...state.runs.values()], putRun: (value) => { state.runs.set(value.id, value); }, listAttempts: (runId) => state.attempts.get(runId) ?? [], putAttempt: (value) => { const values = state.attempts.get(value.runId) ?? []; const index = values.findIndex((item) => item.id === value.id); if (index < 0) values.push(value); else values[index] = value; state.attempts.set(value.runId, values); }, nextFencingToken: (runId) => { const next = (state.fencing.get(runId) ?? 0) + 1; state.fencing.set(runId, next); return next; } }; }
async function persist(client: ExecutionPostgresClient, state: State): Promise<void> { for (const value of state.runs.values()) await client.query("INSERT INTO execution_runs (id,tenant_id,application_id,idempotency_key,resource_json) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET resource_json=EXCLUDED.resource_json", [value.id, value.tenantId, value.applicationId, value.idempotencyKey, JSON.stringify(value)]); for (const values of state.attempts.values()) for (const value of values) await client.query("INSERT INTO execution_attempts (id,run_id,number,resource_json) VALUES ($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET resource_json=EXCLUDED.resource_json", [value.id, value.runId, value.number, JSON.stringify(value)]); for (const [runId, value] of state.fencing) await client.query("INSERT INTO execution_fencing (run_id,value) VALUES ($1,$2) ON CONFLICT(run_id) DO UPDATE SET value=EXCLUDED.value", [runId, value]); }
function parse<Value>(row: JsonRow): Value { return JSON.parse(row.resource_json) as Value; }
