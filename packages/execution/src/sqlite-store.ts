import type { ExecutionAttempt, ExecutionRun, ExecutionStore, ExecutionTransaction } from "./types.js";

export interface SqliteExecutionDatabase {
  exec(sql: string): unknown;
  query(sql: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}

const migration = `
CREATE TABLE IF NOT EXISTS execution_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, application_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, resource_json TEXT NOT NULL, UNIQUE(tenant_id,application_id,idempotency_key));
CREATE TABLE IF NOT EXISTS execution_attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, number INTEGER NOT NULL, resource_json TEXT NOT NULL, UNIQUE(run_id,number));
CREATE TABLE IF NOT EXISTS execution_fencing (run_id TEXT PRIMARY KEY, value INTEGER NOT NULL);
`;

export class SqliteExecutionStore implements ExecutionStore {
  constructor(private readonly database: SqliteExecutionDatabase) { database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;"); database.exec(migration); }
  async transaction<Result>(work: (transaction: ExecutionTransaction) => Result): Promise<Result> {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = work(this.tx()); this.database.exec("COMMIT"); return result; } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  async listRuns(): Promise<readonly ExecutionRun[]> { return this.database.query("SELECT resource_json FROM execution_runs ORDER BY id").all().map(parse<ExecutionRun>); }
  async listAttempts(runId: string): Promise<readonly ExecutionAttempt[]> { return this.database.query("SELECT resource_json FROM execution_attempts WHERE run_id=? ORDER BY number").all(runId).map(parse<ExecutionAttempt>); }
  async purgeThread(threadId: string): Promise<number> { const ids = (await this.listRuns()).filter((run) => run.payload?.threadId === threadId).map((run) => run.id); this.database.exec("BEGIN IMMEDIATE"); try { for (const id of ids) { this.database.query("DELETE FROM execution_attempts WHERE run_id=?").run(id); this.database.query("DELETE FROM execution_fencing WHERE run_id=?").run(id); this.database.query("DELETE FROM execution_runs WHERE id=?").run(id); } this.database.exec("COMMIT"); return ids.length; } catch (error) { this.database.exec("ROLLBACK"); throw error; } }
  private tx(): ExecutionTransaction { return {
    getRun: (id) => optional<ExecutionRun>(this.database.query("SELECT resource_json FROM execution_runs WHERE id=?").get(id)),
    findByIdempotency: (tenantId, applicationId, key) => optional<ExecutionRun>(this.database.query("SELECT resource_json FROM execution_runs WHERE tenant_id=? AND application_id=? AND idempotency_key=?").get(tenantId, applicationId, key)),
    listRuns: () => this.database.query("SELECT resource_json FROM execution_runs ORDER BY id").all().map(parse<ExecutionRun>),
    putRun: (value) => { this.database.query("INSERT INTO execution_runs (id,tenant_id,application_id,idempotency_key,resource_json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET resource_json=excluded.resource_json").run(value.id, value.tenantId, value.applicationId, value.idempotencyKey, JSON.stringify(value)); },
    listAttempts: (runId) => this.database.query("SELECT resource_json FROM execution_attempts WHERE run_id=? ORDER BY number").all(runId).map(parse<ExecutionAttempt>),
    putAttempt: (value) => { this.database.query("INSERT INTO execution_attempts (id,run_id,number,resource_json) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET resource_json=excluded.resource_json").run(value.id, value.runId, value.number, JSON.stringify(value)); },
    nextFencingToken: (runId) => (this.database.query("INSERT INTO execution_fencing (run_id,value) VALUES (?,1) ON CONFLICT(run_id) DO UPDATE SET value=value+1 RETURNING value").get(runId) as { value: number }).value,
  }; }
}

interface JsonRow { readonly resource_json: string; }
function parse<Value>(row: unknown): Value { if (!row || typeof row !== "object" || !("resource_json" in row) || typeof row.resource_json !== "string") throw new Error("Execution row is invalid."); return JSON.parse(row.resource_json) as Value; }
function optional<Value>(row: unknown): Value | undefined { return row ? parse<Value>(row) : undefined; }
