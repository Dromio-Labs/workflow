import type { Database } from "bun:sqlite";
import type {
  PutSignalOccurrenceInput,
  PutSignalOccurrenceResult,
  SignalDeliveryClaim,
  SignalWaitSnapshot,
  StoredSignalOccurrence,
} from "../types.js";

type OccurrenceRow = {
  attempts: number;
  correlation_hash: string;
  correlation_json: string;
  created_at: string;
  error: string | null;
  id: string;
  idempotency_key: string;
  locked_by: string | null;
  locked_until: string | null;
  occurred_at: string;
  payload_hash: string;
  payload_json: string;
  run_id: string | null;
  signal_id: string;
  status: StoredSignalOccurrence["status"];
  updated_at: string;
  wait_token: string | null;
};

type WaitRow = {
  contract_fingerprint: string;
  correlation_hash: string;
  correlation_json: string;
  created_at: string;
  run_id: string;
  signal_id: string;
  status: SignalWaitSnapshot["status"];
  step_id: string;
  token: string;
  updated_at: string;
};

export function putSignalOccurrence(
  database: Database,
  input: PutSignalOccurrenceInput,
): PutSignalOccurrenceResult {
  const inserted = database.run(
    `insert or ignore into signal_occurrences (
      id, signal_id, idempotency_key, correlation_json, correlation_hash,
      payload_json, payload_hash, occurred_at, status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [input.id, input.signalId, input.idempotencyKey,
      JSON.stringify(input.correlation), input.correlationHash,
      JSON.stringify(input.payload), input.payloadHash, input.occurredAt,
      input.createdAt, input.updatedAt],
  );
  return {
    created: inserted.changes === 1,
    occurrence: requireByKey(database, input.signalId, input.idempotencyKey),
  };
}

export function getSignalOccurrence(
  database: Database,
  id: string,
): StoredSignalOccurrence | undefined {
  const row = database.query("select * from signal_occurrences where id = ?")
    .get(id) as OccurrenceRow | null;
  return row ? occurrenceFromRow(row) : undefined;
}

export function syncSignalWaits(
  database: Database,
  input: { now: string; runId: string; waits: SignalWaitSnapshot[] },
): void {
  database.transaction(() => {
    const active = new Set(input.waits.map((wait) => wait.token));
    const rows = database.query(
      "select token from signal_waits where run_id = ? and status = 'pending'",
    ).all(input.runId) as Array<{ token: string }>;
    for (const row of rows) {
      if (!active.has(row.token)) {
        database.run("delete from signal_waits where token = ? and status = 'pending'", [row.token]);
      }
    }
    for (const wait of input.waits) upsertWait(database, wait, input.now);
  })();
}

export function claimNextSignalDelivery(
  database: Database,
  input: { leaseMs: number; now: string; workerId: string },
): SignalDeliveryClaim | undefined {
  return database.transaction(() => {
    releaseExpiredClaims(database, input.now);
    const pair = database.query(
      `select occurrence.id as occurrence_id, wait.token as wait_token
       from signal_occurrences occurrence join signal_waits wait
         on wait.signal_id = occurrence.signal_id
        and wait.correlation_hash = occurrence.correlation_hash
        and wait.status = 'pending'
       where occurrence.status = 'pending'
       order by occurrence.created_at asc, wait.created_at asc limit 1`,
    ).get() as { occurrence_id: string; wait_token: string } | null;
    if (!pair) return undefined;
    const lockedUntil = new Date(Date.parse(input.now) + input.leaseMs).toISOString();
    database.run(
      `update signal_occurrences set status = 'claimed', attempts = attempts + 1,
       locked_by = ?, locked_until = ?, wait_token = ?, updated_at = ? where id = ?`,
      [input.workerId, lockedUntil, pair.wait_token, input.now, pair.occurrence_id],
    );
    database.run(
      `update signal_waits set status = 'claimed', occurrence_id = ?, updated_at = ?
       where token = ?`,
      [pair.occurrence_id, input.now, pair.wait_token],
    );
    return {
      occurrence: requireOccurrence(database, pair.occurrence_id),
      wait: requireWait(database, pair.wait_token),
    };
  })();
}

export function completeSignalDelivery(
  database: Database,
  input: { now: string; occurrenceId: string; runId: string; waitToken: string },
): StoredSignalOccurrence {
  return database.transaction(() => {
    database.run(
      `update signal_occurrences set status = 'delivered', run_id = ?, wait_token = ?,
       locked_by = null, locked_until = null, error = null, updated_at = ? where id = ?`,
      [input.runId, input.waitToken, input.now, input.occurrenceId],
    );
    database.run(
      `update signal_waits set status = 'consumed', updated_at = ?
       where token = ? and occurrence_id = ?`,
      [input.now, input.waitToken, input.occurrenceId],
    );
    return requireOccurrence(database, input.occurrenceId);
  })();
}

export function failSignalDelivery(
  database: Database,
  input: { error: string; now: string; occurrenceId: string; retry: boolean },
): StoredSignalOccurrence {
  return database.transaction(() => {
    const occurrence = requireOccurrence(database, input.occurrenceId);
    if (occurrence.waitToken) releaseWait(database, occurrence.waitToken, input.now);
    database.run(
      `update signal_occurrences set status = ?, error = ?, wait_token = null,
       locked_by = null, locked_until = null, updated_at = ? where id = ?`,
      [input.retry ? "pending" : "failed", input.error, input.now, input.occurrenceId],
    );
    return requireOccurrence(database, input.occurrenceId);
  })();
}

function upsertWait(database: Database, wait: SignalWaitSnapshot, now: string): void {
  database.run(
    `insert into signal_waits (token, signal_id, contract_fingerprint,
      correlation_json, correlation_hash, run_id, step_id, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     on conflict(token) do update set signal_id = excluded.signal_id,
      contract_fingerprint = excluded.contract_fingerprint,
      correlation_json = excluded.correlation_json,
      correlation_hash = excluded.correlation_hash, run_id = excluded.run_id,
      step_id = excluded.step_id, updated_at = excluded.updated_at`,
    [wait.token, wait.signalId, wait.contractFingerprint,
      JSON.stringify(wait.correlation), wait.correlationHash, wait.runId,
      wait.stepId, wait.createdAt, now],
  );
}

function releaseExpiredClaims(database: Database, now: string): void {
  const rows = database.query(
    `select id, wait_token from signal_occurrences
     where status = 'claimed' and locked_until <= ?`,
  ).all(now) as Array<{ id: string; wait_token: string | null }>;
  for (const row of rows) {
    if (row.wait_token) releaseWait(database, row.wait_token, now);
    database.run(
      `update signal_occurrences set status = 'pending', wait_token = null,
       locked_by = null, locked_until = null, updated_at = ? where id = ?`,
      [now, row.id],
    );
  }
}

function releaseWait(database: Database, token: string, now: string): void {
  database.run(
    `update signal_waits set status = 'pending', occurrence_id = null, updated_at = ?
     where token = ? and status = 'claimed'`,
    [now, token],
  );
}

function requireOccurrence(database: Database, id: string): StoredSignalOccurrence {
  const occurrence = getSignalOccurrence(database, id);
  if (!occurrence) throw new Error(`Unknown signal occurrence: ${id}`);
  return occurrence;
}

function requireByKey(database: Database, signalId: string, key: string): StoredSignalOccurrence {
  const row = database.query(
    "select * from signal_occurrences where signal_id = ? and idempotency_key = ?",
  ).get(signalId, key) as OccurrenceRow | null;
  if (!row) throw new Error(`Unknown signal occurrence key: ${signalId}/${key}`);
  return occurrenceFromRow(row);
}

function requireWait(database: Database, token: string): SignalWaitSnapshot {
  const row = database.query("select * from signal_waits where token = ?")
    .get(token) as WaitRow | null;
  if (!row) throw new Error(`Unknown signal wait: ${token}`);
  return {
    contractFingerprint: row.contract_fingerprint,
    correlation: JSON.parse(row.correlation_json),
    correlationHash: row.correlation_hash,
    createdAt: row.created_at,
    runId: row.run_id,
    signalId: row.signal_id,
    status: row.status,
    stepId: row.step_id,
    token: row.token,
    updatedAt: row.updated_at,
  };
}

function occurrenceFromRow(row: OccurrenceRow): StoredSignalOccurrence {
  return {
    attempts: Number(row.attempts), correlation: JSON.parse(row.correlation_json),
    correlationHash: row.correlation_hash, createdAt: row.created_at,
    error: row.error ?? undefined, id: row.id,
    idempotencyKey: row.idempotency_key, lockedBy: row.locked_by ?? undefined,
    lockedUntil: row.locked_until ?? undefined, occurredAt: row.occurred_at,
    payload: JSON.parse(row.payload_json), payloadHash: row.payload_hash,
    runId: row.run_id ?? undefined, signalId: row.signal_id, status: row.status,
    updatedAt: row.updated_at, waitToken: row.wait_token ?? undefined,
  };
}
