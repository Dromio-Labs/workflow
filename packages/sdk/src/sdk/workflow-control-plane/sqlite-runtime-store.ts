import type {
  EnqueueTriggerResult,
  RuntimeRetentionResult,
  StoredWorkflowRunSnapshot,
  TriggerJobStatus,
  WorkflowRuntimeStore,
} from "./types.js";
import type {
  EventRecord,
} from "../core/index.js";
import {
  leaseExpiresAt,
} from "@dromio/workflow-kernel";
import {
  attachWorkflowArtifactRefs,
  getWorkflowArtifactContent,
  listWorkflowArtifactRefs,
  putWorkflowArtifactContent,
  recordWorkflowArtifactRef,
} from "./sqlite-runtime-store/artifacts.js";
import {
  countDatasetRows,
  datasetFreshness,
  listDatasets,
  queryDatasetRows,
  upsertDatasetRows,
} from "./sqlite-runtime-store/datasets.js";
import {
  isTerminalRunStatus,
  openRuntimeDb,
  requireTriggerJob,
  rowToTriggerJob,
  workflowRuntimeBytes,
  type TriggerJobRow,
} from "./sqlite-runtime-store/db.js";
import {
  claimNextSignalDelivery as claimNextSqliteSignalDelivery,
  completeSignalDelivery as completeSqliteSignalDelivery,
  failSignalDelivery as failSqliteSignalDelivery,
  getSignalOccurrence as getSqliteSignalOccurrence,
  putSignalOccurrence as putSqliteSignalOccurrence,
  syncSignalWaits as syncSqliteSignalWaits,
} from "./sqlite-runtime-store/signals.js";

export function createSqliteWorkflowRuntimeStore(filePath: string): WorkflowRuntimeStore {
  const database = openRuntimeDb(filePath);

  return {
    appendWorkflowRunEvents(runId, events) {
      const insert = database.prepare(
        `insert or replace into workflow_events (
          run_id, event_index, event_type, event_json, timestamp
        ) values (?, ?, ?, ?, ?)`,
      );
      const transaction = database.transaction((items: EventRecord[]) => {
        for (const event of items) {
          insert.run(runId, event.index, event.type, JSON.stringify(event), event.timestamp);
        }
      });
      transaction(events);
    },
    claimNextSignalDelivery(input) {
      return claimNextSqliteSignalDelivery(database, input);
    },
    claimNextTriggerJob(input) {
      const transaction = database.transaction(() => {
        const row = database.query(
          `select * from trigger_jobs
           where available_at <= ?
             and (
               status in ('queued', 'retrying')
               or (status in ('claimed', 'running') and locked_until is not null and locked_until <= ?)
             )
           order by created_at asc
           limit 1`,
        ).get(input.now, input.now) as TriggerJobRow | null;
        if (!row) return undefined;
        const lockedUntil = leaseExpiresAt(new Date(input.now), input.leaseMs).toISOString();
        database.run(
          `update trigger_jobs
           set status = 'claimed',
               attempts = attempts + 1,
               locked_by = ?,
               locked_until = ?,
               updated_at = ?
           where id = ?`,
          [input.workerId, lockedUntil, input.now, row.id],
        );
        return rowToTriggerJob({
          ...row,
          attempts: row.attempts + 1,
          locked_by: input.workerId,
          locked_until: lockedUntil,
          status: "claimed",
          updated_at: input.now,
        });
      });
      return transaction();
    },
    completeTriggerJob(input) {
      const current = requireTriggerJob(database, input.jobId);
      database.run(
        `update trigger_jobs
         set status = 'completed',
             run_id = coalesce(?, run_id),
             locked_by = null,
             locked_until = null,
             updated_at = ?,
             error = ?
         where id = ?`,
        [input.runId ?? null, input.now, input.reason ?? null, input.jobId],
      );
      return {
        ...current,
        error: input.reason,
        lockedBy: undefined,
        lockedUntil: undefined,
        runId: input.runId ?? current.runId,
        status: "completed",
        updatedAt: input.now,
      };
    },
    completeSignalDelivery(input) {
      return completeSqliteSignalDelivery(database, input);
    },
    heartbeatTriggerJob(input) {
      const current = requireTriggerJob(database, input.jobId);
      if (!["claimed", "running"].includes(current.status)) {
        throw new Error(`Cannot heartbeat ${current.status} trigger job ${current.id}.`);
      }
      const lockedUntil = leaseExpiresAt(new Date(input.now), input.leaseMs).toISOString();
      database.run(
        "update trigger_jobs set locked_until = ?, updated_at = ? where id = ?",
        [lockedUntil, input.now, input.jobId],
      );
      return { ...current, lockedUntil, updatedAt: input.now };
    },
    cancelTriggerJob(input) {
      const current = requireTriggerJob(database, input.jobId);
      if (["completed", "dead"].includes(current.status)) return current;
      database.run(
        `update trigger_jobs
         set status = 'dead',
             error = ?,
             locked_by = null,
             locked_until = null,
             updated_at = ?
         where id = ?`,
        [input.error, input.now, input.jobId],
      );
      return {
        ...current,
        error: input.error,
        lockedBy: undefined,
        lockedUntil: undefined,
        status: "dead",
        updatedAt: input.now,
      };
    },
    deadLetterTriggerJob(input) {
      const current = requireTriggerJob(database, input.jobId);
      database.run(
        `update trigger_jobs
         set status = 'dead',
             error = ?,
             locked_by = null,
             locked_until = null,
             updated_at = ?
         where id = ?`,
        [input.error, input.now, input.jobId],
      );
      return {
        ...current,
        error: input.error,
        lockedBy: undefined,
        lockedUntil: undefined,
        status: "dead",
        updatedAt: input.now,
      };
    },
    enqueueTriggerJob(input) {
      const result = database.run(
        `insert or ignore into trigger_jobs (
          id, trigger_id, workflow_id, occurrence_id, idempotency_key, kind, status,
          payload_json, payload_hash, attempts, max_attempts, available_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.triggerId,
          input.workflowId,
          input.occurrenceId,
          input.idempotencyKey ?? null,
          input.kind ?? "trigger",
          input.status,
          JSON.stringify(input.payload),
          input.payloadHash ?? null,
          0,
          input.maxAttempts,
          input.availableAt,
          input.createdAt,
          input.updatedAt,
        ],
      );
      if (result.changes === 0) {
        const existing = existingTriggerJobByUniqueKey(input);
        if (existing) {
          return {
            created: false,
            job: rowToTriggerJob(existing),
          };
        }
        throw new Error("Trigger job insert was ignored without a matching idempotency or occurrence key.");
      }
      return {
        created: true,
        job: {
          attempts: 0,
          availableAt: input.availableAt,
          createdAt: input.createdAt,
          id: input.id,
          idempotencyKey: input.idempotencyKey,
          kind: input.kind ?? "trigger",
          maxAttempts: input.maxAttempts,
          occurrenceId: input.occurrenceId,
          payload: input.payload,
          status: input.status,
          triggerId: input.triggerId,
          updatedAt: input.updatedAt,
          workflowId: input.workflowId,
        },
      } satisfies EnqueueTriggerResult;
    },
    failTriggerJob(input) {
      const current = requireTriggerJob(database, input.jobId);
      const nextStatus: TriggerJobStatus = input.retry ? "retrying" : "dead";
      const availableAt = input.retry
        ? new Date(Date.parse(input.now) + input.retryDelayMs).toISOString()
        : current.availableAt;
      database.run(
        `update trigger_jobs
         set status = ?,
             error = ?,
             available_at = ?,
             locked_by = null,
             locked_until = null,
             updated_at = ?
         where id = ?`,
        [nextStatus, input.error, availableAt, input.now, input.jobId],
      );
      return {
        ...current,
        availableAt,
        error: input.error,
        lockedBy: undefined,
        lockedUntil: undefined,
        status: nextStatus,
        updatedAt: input.now,
      };
    },
    failSignalDelivery(input) {
      return failSqliteSignalDelivery(database, input);
    },
    getSignalOccurrence(id) {
      return getSqliteSignalOccurrence(database, id);
    },
    retryTriggerJob(input) {
      const current = requireTriggerJob(database, input.jobId);
      database.run(
        `update trigger_jobs
         set status = 'retrying',
             available_at = ?,
             locked_by = null,
             locked_until = null,
             error = null,
             updated_at = ?
         where id = ?`,
        [input.availableAt, input.now, input.jobId],
      );
      return {
        ...current,
        availableAt: input.availableAt,
        error: undefined,
        lockedBy: undefined,
        lockedUntil: undefined,
        status: "retrying",
        updatedAt: input.now,
      };
    },
    getTriggerJob(id) {
      const row = database.query("select * from trigger_jobs where id = ?").get(id) as TriggerJobRow | null;
      return row ? rowToTriggerJob(row) : undefined;
    },
    getArtifactContent(artifactId) {
      return getWorkflowArtifactContent(database, artifactId);
    },
    getWorkflowRun(id) {
      const row = database.query("select snapshot_json from workflow_runs where id = ?").get(id) as
        | { snapshot_json: string }
        | null;
      return row ? attachWorkflowArtifactRefs(database, JSON.parse(row.snapshot_json) as StoredWorkflowRunSnapshot) : undefined;
    },
    countDatasetRows(definition) {
      return countDatasetRows(database, definition);
    },
    datasetFreshness(definition) {
      return datasetFreshness(database, definition);
    },
    listDatasets() {
      return listDatasets(database);
    },
    listArtifactRefs(runId) {
      return listWorkflowArtifactRefs(database, runId);
    },
    listTriggerJobs(filter = {}) {
      const clauses: string[] = [];
      const params: Array<string | number | null> = [];
      if (filter.workflowId) {
        clauses.push("workflow_id = ?");
        params.push(filter.workflowId);
      }
      if (filter.triggerId) {
        clauses.push("trigger_id = ?");
        params.push(filter.triggerId);
      }
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        clauses.push(`status in (${statuses.map(() => "?").join(", ")})`);
        params.push(...statuses);
      }
      if (filter.kind) {
        clauses.push("kind = ?");
        params.push(filter.kind);
      }
      const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
      const rows = database.query(`select * from trigger_jobs ${where} order by created_at desc`).all(...params) as TriggerJobRow[];
      return rows.map(rowToTriggerJob);
    },
    listWorkflowRuns(filter = {}) {
      const clauses: string[] = [];
      const params: Array<string | number | null> = [];
      if (filter.workflowId) {
        clauses.push("workflow_id = ?");
        params.push(filter.workflowId);
      }
      if (filter.originType) {
        clauses.push("origin_type = ?");
        params.push(filter.originType);
      }
      const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
      const rows = database.query(
        `select snapshot_json from workflow_runs ${where} order by updated_at desc`,
      ).all(...params) as Array<{ snapshot_json: string }>;
      return rows.map((row) =>
        attachWorkflowArtifactRefs(database, JSON.parse(row.snapshot_json) as StoredWorkflowRunSnapshot)
      );
    },
    markTriggerJobRunning(input) {
      const current = requireTriggerJob(database, input.jobId);
      database.run(
        `update trigger_jobs
         set status = 'running',
             run_id = ?,
             updated_at = ?
         where id = ?`,
        [input.runId, input.now, input.jobId],
      );
      return {
        ...current,
        runId: input.runId,
        status: "running",
        updatedAt: input.now,
      };
    },
    putArtifactContent(input) {
      putWorkflowArtifactContent(database, input);
    },
    putSignalOccurrence(input) {
      return putSqliteSignalOccurrence(database, input);
    },
    putWorkflowRun(snapshot) {
      database.run(
        `insert into workflow_runs (
          id, workflow_id, status, input_json, origin_type, origin_json, snapshot_json,
          created_at, updated_at, completed_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          workflow_id = excluded.workflow_id,
          status = excluded.status,
          input_json = excluded.input_json,
          origin_type = excluded.origin_type,
          origin_json = excluded.origin_json,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at`,
        [
          snapshot.runId,
          snapshot.workflowId,
          snapshot.status,
          JSON.stringify(snapshot.input),
          snapshot.origin?.type ?? null,
          JSON.stringify(snapshot.origin ?? null),
          JSON.stringify(snapshot),
          snapshot.events[0]?.timestamp ?? new Date().toISOString(),
          new Date().toISOString(),
          isTerminalRunStatus(snapshot.status) ? new Date().toISOString() : null,
        ],
      );
    },
    pruneRuntime(input) {
      const workflows = database.query(
        `select workflow_id as workflowId from workflow_runs
         union
         select workflow_id as workflowId from trigger_jobs`,
      ).all() as Array<{ workflowId: string }>;
      const summaries: RuntimeRetentionResult["workflows"] = [];
      const transaction = database.transaction((workflowId: string) => {
        const beforeBytes = workflowRuntimeBytes(database, workflowId);
        let afterBytes = beforeBytes;
        let deletedJobs = 0;
        let deletedRuns = 0;
        let deletedEvents = 0;
        const terminalJobs = database.query(
          `select id, run_id from trigger_jobs
           where workflow_id = ?
             and status in ('completed', 'dead', 'failed')
           order by updated_at asc, created_at asc`,
        ).all(workflowId) as Array<{ id: string; run_id: string | null }>;
        for (const job of terminalJobs) {
          if (afterBytes <= input.maxBytesPerWorkflow) break;
          if (job.run_id) {
            deletedEvents += Number((database.query(
              "select count(*) as count from workflow_events where run_id = ?",
            ).get(job.run_id) as { count: number }).count);
            database.run("delete from workflow_events where run_id = ?", [job.run_id]);
            deletedRuns += database.run(
              "delete from workflow_runs where id = ? and status in ('completed', 'failed', 'cancelled')",
              [job.run_id],
            ).changes;
          }
          deletedJobs += database.run("delete from trigger_jobs where id = ?", [job.id]).changes;
          afterBytes = workflowRuntimeBytes(database, workflowId);
        }
        const terminalRuns = database.query(
          `select id from workflow_runs
           where workflow_id = ?
             and status in ('completed', 'failed', 'cancelled')
           order by coalesce(completed_at, updated_at) asc`,
        ).all(workflowId) as Array<{ id: string }>;
        for (const run of terminalRuns) {
          if (afterBytes <= input.maxBytesPerWorkflow) break;
          deletedEvents += Number((database.query(
            "select count(*) as count from workflow_events where run_id = ?",
          ).get(run.id) as { count: number }).count);
          database.run("delete from workflow_events where run_id = ?", [run.id]);
          deletedRuns += database.run("delete from workflow_runs where id = ?", [run.id]).changes;
          afterBytes = workflowRuntimeBytes(database, workflowId);
        }
        return {
          afterBytes,
          beforeBytes,
          deletedEvents,
          deletedJobs,
          deletedRuns,
          workflowId,
        };
      });
      for (const { workflowId } of workflows) {
        summaries.push(transaction(workflowId));
      }
      return {
        maxBytesPerWorkflow: input.maxBytesPerWorkflow,
        workflows: summaries,
      };
    },
    recordArtifactRef(runId, artifact) {
      recordWorkflowArtifactRef(database, runId, artifact);
    },
    syncSignalWaits(input) {
      syncSqliteSignalWaits(database, input);
    },
    queryDatasetRows(definition, query) {
      return queryDatasetRows(database, definition, query);
    },
    upsertDatasetRows(input) {
      return upsertDatasetRows(database, input);
    },
  };

  function existingTriggerJobByUniqueKey(
    input: Parameters<WorkflowRuntimeStore["enqueueTriggerJob"]>[0],
  ): TriggerJobRow | null {
    if (input.idempotencyKey) {
      const existing = database.query(
        "select * from trigger_jobs where trigger_id = ? and idempotency_key = ?",
      ).get(input.triggerId, input.idempotencyKey) as TriggerJobRow | null;
      if (existing) return existing;
    }
    return database.query(
      "select * from trigger_jobs where trigger_id = ? and occurrence_id = ?",
    ).get(input.triggerId, input.occurrenceId) as TriggerJobRow | null;
  }
}
