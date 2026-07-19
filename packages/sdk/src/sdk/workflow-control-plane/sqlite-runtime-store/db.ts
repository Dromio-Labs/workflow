import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  TriggerJobPayload,
  TriggerJobSnapshot,
  TriggerJobStatus,
} from "../types.js";

export type TriggerJobRow = {
  attempts: number;
  available_at: string;
  created_at: string;
  error: string | null;
  id: string;
  idempotency_key: string | null;
  kind: string | null;
  locked_by: string | null;
  locked_until: string | null;
  max_attempts: number;
  occurrence_id: string;
  payload_hash: string | null;
  payload_json: string;
  run_id: string | null;
  status: TriggerJobStatus;
  trigger_id: string;
  updated_at: string;
  workflow_id: string;
};

export function openRuntimeDb(filePath: string): Database {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new Database(filePath, { create: true });
  database.run("pragma journal_mode = WAL");
  database.run("pragma busy_timeout = 5000");
  initialize(database);
  return database;
}

export function workflowRuntimeBytes(database: Database, workflowId: string): number {
  const jobBytes = database.query(
    `select coalesce(sum(length(payload_json) + length(coalesce(error, ''))), 0) as bytes
     from trigger_jobs where workflow_id = ?`,
  ).get(workflowId) as { bytes: number };
  const runBytes = database.query(
    `select coalesce(sum(length(snapshot_json) + length(input_json) + length(coalesce(origin_json, ''))), 0) as bytes
     from workflow_runs where workflow_id = ?`,
  ).get(workflowId) as { bytes: number };
  const eventBytes = database.query(
    `select coalesce(sum(length(workflow_events.event_json)), 0) as bytes
     from workflow_events
     join workflow_runs on workflow_runs.id = workflow_events.run_id
     where workflow_runs.workflow_id = ?`,
  ).get(workflowId) as { bytes: number };
  return Number(jobBytes.bytes) + Number(runBytes.bytes) + Number(eventBytes.bytes);
}

export function requireTriggerJob(database: Database, id: string): TriggerJobSnapshot {
  const row = database.query("select * from trigger_jobs where id = ?").get(id) as TriggerJobRow | null;
  if (!row) throw new Error(`Unknown trigger job: ${id}`);
  return rowToTriggerJob(row);
}

export function rowToTriggerJob(row: TriggerJobRow): TriggerJobSnapshot {
  return {
    attempts: Number(row.attempts),
    availableAt: row.available_at,
    createdAt: row.created_at,
    error: row.error ?? undefined,
    id: row.id,
    idempotencyKey: row.idempotency_key ?? undefined,
    kind: row.kind === "timer" ? "timer" : "trigger",
    lockedBy: row.locked_by ?? undefined,
    lockedUntil: row.locked_until ?? undefined,
    maxAttempts: Number(row.max_attempts),
    occurrenceId: row.occurrence_id,
    payload: JSON.parse(row.payload_json) as TriggerJobPayload,
    runId: row.run_id ?? undefined,
    status: row.status,
    triggerId: row.trigger_id,
    updatedAt: row.updated_at,
    workflowId: row.workflow_id,
  };
}

export function isTerminalRunStatus(status: string) {
  return status === "cancelled" || status === "completed" || status === "failed";
}

function initialize(database: Database): void {
  database.run(`create table if not exists trigger_jobs (
    id text primary key,
    trigger_id text not null,
    workflow_id text not null,
    occurrence_id text not null,
    idempotency_key text,
    kind text not null default 'trigger',
    status text not null,
    payload_json text not null,
    payload_hash text,
    attempts integer not null default 0,
    max_attempts integer not null default 3,
    available_at text not null,
    locked_by text,
    locked_until text,
    run_id text,
    error text,
    created_at text not null,
    updated_at text not null
  )`);
  ensureColumn(database, "trigger_jobs", "kind", "text not null default 'trigger'");
  ensureColumn(database, "trigger_jobs", "payload_hash", "text");
  database.run("create index if not exists trigger_jobs_claim_idx on trigger_jobs(status, available_at, locked_until)");
  database.run("create index if not exists trigger_jobs_workflow_idx on trigger_jobs(workflow_id, created_at)");
  database.run("create unique index if not exists trigger_jobs_occurrence_unique on trigger_jobs(trigger_id, occurrence_id)");
  database.run(`create unique index if not exists trigger_jobs_idempotency_unique
    on trigger_jobs(trigger_id, idempotency_key)
    where idempotency_key is not null`);
  database.run(`create table if not exists workflow_runs (
    id text primary key,
    workflow_id text not null,
    status text not null,
    input_json text not null,
    origin_type text,
    origin_json text,
    snapshot_json text not null,
    created_at text not null,
    updated_at text not null,
    completed_at text
  )`);
  database.run("create index if not exists workflow_runs_workflow_idx on workflow_runs(workflow_id, updated_at)");
  database.run(`create table if not exists workflow_events (
    run_id text not null,
    event_index integer not null,
    event_type text not null,
    event_json text not null,
    timestamp text not null,
    primary key(run_id, event_index)
  )`);
  database.run("create index if not exists workflow_events_run_idx on workflow_events(run_id, event_index)");
  database.run(`create table if not exists signal_occurrences (
    id text primary key,
    signal_id text not null,
    idempotency_key text not null,
    correlation_json text not null,
    correlation_hash text not null,
    payload_json text not null,
    payload_hash text not null,
    occurred_at text not null,
    status text not null,
    attempts integer not null default 0,
    locked_by text,
    locked_until text,
    wait_token text,
    run_id text,
    error text,
    created_at text not null,
    updated_at text not null
  )`);
  database.run(`create unique index if not exists signal_occurrences_idempotency_unique
    on signal_occurrences(signal_id, idempotency_key)`);
  database.run(`create index if not exists signal_occurrences_match_idx
    on signal_occurrences(signal_id, correlation_hash, status, created_at)`);
  database.run(`create table if not exists signal_waits (
    token text primary key,
    signal_id text not null,
    contract_fingerprint text not null,
    correlation_json text not null,
    correlation_hash text not null,
    run_id text not null,
    step_id text not null,
    status text not null,
    occurrence_id text,
    created_at text not null,
    updated_at text not null
  )`);
  database.run(`create unique index if not exists signal_waits_occurrence_unique
    on signal_waits(occurrence_id) where occurrence_id is not null`);
  database.run(`create index if not exists signal_waits_match_idx
    on signal_waits(signal_id, correlation_hash, status, created_at)`);
  database.run(`create table if not exists workflow_artifacts (
    artifact_id text primary key,
    kind text not null,
    media_type text,
    title text,
    metadata_json text,
    content text not null,
    created_at text not null
  )`);
  database.run(`create table if not exists workflow_run_artifacts (
    run_id text not null,
    artifact_id text not null,
    ref_json text not null,
    created_at text not null,
    primary key(run_id, artifact_id)
  )`);
  database.run("create index if not exists workflow_run_artifacts_run_idx on workflow_run_artifacts(run_id, created_at)");
  database.run(`create table if not exists dataset_registry (
    name text primary key,
    version integer not null,
    schema_fingerprint text not null,
    created_at text not null
  )`);
  database.run(`create table if not exists idempotency_keys (
    scope text not null,
    key text not null,
    job_id text not null,
    created_at text not null,
    primary key(scope, key)
  )`);
  database.run(`create table if not exists runtime_locks (
    id text primary key,
    locked_by text not null,
    locked_until text not null,
    updated_at text not null
  )`);
  database.run(`create table if not exists runtime_meta (
    key text primary key,
    value text not null,
    updated_at text not null
  )`);
}

function ensureColumn(database: Database, table: string, column: string, definition: string): void {
  const rows = database.query(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    database.run(`alter table ${table} add column ${column} ${definition}`);
  }
}
