import type { Database } from "bun:sqlite";
import type {
  WorkflowRunArtifactRef,
} from "../../core/index.js";
import {
  toJsonObject,
} from "../../shared/json.js";
import type {
  PutArtifactContentInput,
  StoredArtifactContent,
} from "../types.js";

type WorkflowArtifactRow = {
  artifact_id: string;
  content: string;
  created_at: string;
  kind: string;
  media_type: string | null;
  metadata_json: string | null;
  title: string | null;
};

type WorkflowRunArtifactRow = {
  ref_json: string;
};

export function putWorkflowArtifactContent(
  database: Database,
  input: PutArtifactContentInput,
): void {
  const createdAt = new Date().toISOString();
  database.run(
    `insert into workflow_artifacts (
      artifact_id, kind, media_type, title, metadata_json, content, created_at
    ) values (?, ?, ?, ?, ?, ?, ?)
    on conflict(artifact_id) do update set
      kind = excluded.kind,
      media_type = excluded.media_type,
      title = excluded.title,
      metadata_json = excluded.metadata_json,
      content = excluded.content`,
    [
      input.artifactId,
      input.kind,
      input.mediaType ?? null,
      input.title ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.content,
      createdAt,
    ],
  );
}

export function getWorkflowArtifactContent(
  database: Database,
  artifactId: string,
): StoredArtifactContent | undefined {
  const row = database.query(
    "select * from workflow_artifacts where artifact_id = ?",
  ).get(artifactId) as WorkflowArtifactRow | null;
  return row ? rowToArtifactContent(row) : undefined;
}

export function recordWorkflowArtifactRef(
  database: Database,
  runId: string,
  artifact: WorkflowRunArtifactRef,
): void {
  database.run(
    `insert into workflow_run_artifacts (
      run_id, artifact_id, ref_json, created_at
    ) values (?, ?, ?, ?)
    on conflict(run_id, artifact_id) do update set
      ref_json = excluded.ref_json`,
    [runId, artifact.artifactId, JSON.stringify(artifact), new Date().toISOString()],
  );
}

export function listWorkflowArtifactRefs(
  database: Database,
  runId: string,
): WorkflowRunArtifactRef[] {
  const rows = database.query(
    `select ref_json from workflow_run_artifacts
     where run_id = ?
     order by created_at asc, artifact_id asc`,
  ).all(runId) as WorkflowRunArtifactRow[];
  return rows.map((row) => normalizeArtifactRef(JSON.parse(row.ref_json)));
}

export function attachWorkflowArtifactRefs<T extends { runId: string }>(
  database: Database,
  snapshot: T,
): T & { artifactRefs?: WorkflowRunArtifactRef[] } {
  const artifactRefs = listWorkflowArtifactRefs(database, snapshot.runId);
  return artifactRefs.length > 0 ? { ...snapshot, artifactRefs } : snapshot;
}

function rowToArtifactContent(row: WorkflowArtifactRow): StoredArtifactContent {
  return {
    content: row.content,
    createdAt: row.created_at,
    ref: {
      artifactId: row.artifact_id,
      kind: row.kind,
      ...(row.media_type ? { mediaType: row.media_type } : {}),
      ...(row.metadata_json ? { metadata: toJsonObject(JSON.parse(row.metadata_json)) } : {}),
      ...(row.title ? { title: row.title } : {}),
      uri: `artifact:${row.artifact_id}`,
    },
  };
}

function normalizeArtifactRef(value: unknown): WorkflowRunArtifactRef {
  const object = toJsonObject(value);
  const artifactId = String(object.artifactId ?? "");
  const kind = String(object.kind ?? "");
  if (!artifactId || !kind) throw new Error("Persisted workflow artifact ref is missing artifactId or kind.");
  return {
    artifactId,
    kind,
    ...(typeof object.mediaType === "string" ? { mediaType: object.mediaType } : {}),
    ...(object.metadata && typeof object.metadata === "object" && !Array.isArray(object.metadata)
      ? { metadata: toJsonObject(object.metadata) }
      : {}),
    ...(typeof object.title === "string" ? { title: object.title } : {}),
    ...(typeof object.uri === "string" ? { uri: object.uri } : {}),
  };
}
