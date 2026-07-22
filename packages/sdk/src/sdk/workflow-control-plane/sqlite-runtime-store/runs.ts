import type { Database } from "bun:sqlite";

import type { EventRecord } from "../../core/index.js";
import {
  areWorkflowAppRunSnapshotsEquivalent,
  isWorkflowAppRunSnapshotNewer,
  workflowAppRunSnapshotRevision,
} from "../../client/interactions/workflow-app/run-revision.js";
import type {
  StoredWorkflowRunSnapshot,
  WorkflowRunFilter,
} from "../types.js";
import { attachWorkflowArtifactRefs } from "./artifacts.js";

export function appendWorkflowRunEvents(
  database: Database,
  runId: string,
  events: EventRecord[],
): void {
  const insert = database.prepare(
    `insert or ignore into workflow_events (
      run_id, event_index, event_type, event_json, timestamp
    ) values (?, ?, ?, ?, ?)`,
  );
  const transaction = database.transaction((items: EventRecord[]) => {
    for (const event of items) {
      insert.run(runId, event.index, event.type, JSON.stringify(event), event.timestamp);
    }
  });
  transaction(events);
}

export function getWorkflowRun(
  database: Database,
  id: string,
): StoredWorkflowRunSnapshot | undefined {
  const row = database.query("select snapshot_json from workflow_runs where id = ?").get(id) as
    | { snapshot_json: string }
    | null;
  return row
    ? attachWorkflowArtifactRefs(database, JSON.parse(row.snapshot_json) as StoredWorkflowRunSnapshot)
    : undefined;
}

export function listWorkflowRuns(
  database: Database,
  filter: WorkflowRunFilter = {},
): StoredWorkflowRunSnapshot[] {
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
}

export function putWorkflowRun(database: Database, snapshot: StoredWorkflowRunSnapshot) {
  const revision = workflowAppRunSnapshotRevision(snapshot);
  const now = new Date().toISOString();
  const write = database.run(
    `insert into workflow_runs (
      id, workflow_id, status, input_json, origin_type, origin_json, snapshot_json,
      created_at, updated_at, completed_at, revision_index, revision_count, terminal
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      workflow_id = excluded.workflow_id,
      status = excluded.status,
      input_json = excluded.input_json,
      origin_type = excluded.origin_type,
      origin_json = excluded.origin_json,
      snapshot_json = excluded.snapshot_json,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      revision_index = excluded.revision_index,
      revision_count = excluded.revision_count,
      terminal = excluded.terminal
    where (workflow_runs.terminal = 0 or excluded.terminal = 1)
      and (
        excluded.revision_index > workflow_runs.revision_index
        or (
          excluded.revision_index = workflow_runs.revision_index
          and excluded.revision_count > workflow_runs.revision_count
        )
        or (
          excluded.revision_index = workflow_runs.revision_index
          and excluded.revision_count = workflow_runs.revision_count
          and excluded.terminal > workflow_runs.terminal
        )
      )`,
    [
      snapshot.runId,
      snapshot.workflowId,
      snapshot.status,
      JSON.stringify(snapshot.input),
      snapshot.origin?.type ?? null,
      JSON.stringify(snapshot.origin ?? null),
      JSON.stringify(snapshot),
      snapshot.events[0]?.timestamp ?? now,
      now,
      revision.terminal ? now : null,
      revision.eventIndex,
      revision.eventCount,
      revision.terminal ? 1 : 0,
    ],
  );
  if (write.changes > 0) return { accepted: true, snapshot, written: true };
  const stored = getWorkflowRun(database, snapshot.runId);
  if (!stored) throw new Error(`Workflow run ${snapshot.runId} disappeared during persistence.`);
  const storedRevision = workflowAppRunSnapshotRevision(stored);
  return {
    accepted: !(storedRevision.terminal && !revision.terminal)
      && !isWorkflowAppRunSnapshotNewer(stored, snapshot)
      && areWorkflowAppRunSnapshotsEquivalent(stored, snapshot),
    snapshot: stored,
    written: false,
  };
}
