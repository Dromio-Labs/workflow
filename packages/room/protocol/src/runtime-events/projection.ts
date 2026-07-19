import {
  isJsonObject,
} from "../json.js";
import type {
  WorkflowRoomEvent,
  WorkflowRoomRunLink,
  WorkflowRoomSnapshot,
} from "../room.js";
import type {
  WorkflowRunEvent,
} from "../run.js";
import {
  compactObject,
  jsonObjectOrUndefined,
  jsonValue,
  numberValue,
  stringValue,
} from "./json.js";
import {
  toolIdFromRuntimeEvent,
  eventTimestamp,
  runIdFromRuntimeEvent,
  runStatusFromRuntimeEvent,
  runtimeEventId,
  runtimeProgressEvent,
  workflowIdFromRuntimeEvent,
} from "./metadata.js";
import {
  approvalDecisionFromResolution,
  approvalHandRaiseFromRequest,
  toolPayloadMetadata,
  roomArtifactFromRuntimeDescriptor,
  workflowRoomRuntimeEventPayload,
} from "./payloads.js";
import type {
  WorkflowRoomRuntimeEvent,
  WorkflowRoomRuntimeProjectionOptions,
} from "./types.js";

export function workflowRoomEventFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
  options: WorkflowRoomRuntimeProjectionOptions = {},
): WorkflowRoomEvent {
  return compactObject({
    actorParticipantId: options.actorParticipantId,
    createdAt: eventTimestamp(event) ?? options.now?.(),
    id: options.id ?? runtimeEventId(event, options.idPrefix ?? "runtime"),
    kind: event.type,
    payload: workflowRoomRuntimeEventPayload(event, options),
  });
}

export function workflowRunEventFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
  options: WorkflowRoomRuntimeProjectionOptions = {},
): WorkflowRunEvent | undefined {
  const progress = runtimeProgressEvent(event);
  if (!progress) return undefined;
  const runId = stringValue(progress.runId) ?? options.roomRunId;
  if (!runId) return undefined;
  const detail = "detail" in progress ? jsonValue(progress.detail) : undefined;
  return compactObject({
    detail,
    id: runtimeEventId(event, options.idPrefix ?? "run"),
    index: numberValue(progress.index),
    message: stringValue(progress.message),
    runId,
    stepId: stringValue(progress.stepId),
    timestamp: stringValue(progress.timestamp) ??
      eventTimestamp(event) ??
      options.now?.(),
    trace: jsonObjectOrUndefined(progress.trace),
    type: progress.type,
    workflowId: stringValue(progress.workflowId) ??
      options.workflowId ??
      workflowIdFromRuntimeEvent(event),
  });
}

export function workflowRoomRunLinkFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
  options: WorkflowRoomRuntimeProjectionOptions = {},
): WorkflowRoomRunLink | undefined {
  const workflowId = options.workflowId ?? workflowIdFromRuntimeEvent(event);
  if (!workflowId) return undefined;
  const runId = runIdFromRuntimeEvent(event) ?? options.roomRunId;
  const toolId = toolIdFromRuntimeEvent(event);
  const status = runStatusFromRuntimeEvent(event);
  if (!status) return undefined;
  return compactObject({
    createdAt: eventTimestamp(event) ?? options.now?.(),
    id: runId
      ? `run:${runId}`
      : `workflow:${workflowId}:tool:${toolId ?? "runtime"}`,
    metadata: toolPayloadMetadata(event),
    runId,
    status,
    updatedAt: eventTimestamp(event) ?? options.now?.(),
    workflowId,
  });
}

export function workflowRoomSnapshotWithRuntimeEvent(
  snapshot: WorkflowRoomSnapshot,
  event: WorkflowRoomRuntimeEvent,
  options: WorkflowRoomRuntimeProjectionOptions = {},
): WorkflowRoomSnapshot {
  const timestamp = eventTimestamp(event) ??
    options.now?.() ??
    new Date().toISOString();
  const roomEvent = workflowRoomEventFromRuntimeEvent(event, {
    ...options,
    id: options.id ?? nextRoomEventId(snapshot, options.idPrefix ?? "runtime"),
    now: () => timestamp,
  });
  return applyRuntimeEventProjection({
    event,
    options,
    roomEvent,
    snapshot,
    timestamp,
  });
}

export function workflowRoomSnapshotWithRuntimeEvents(
  snapshot: WorkflowRoomSnapshot,
  events: readonly WorkflowRoomRuntimeEvent[],
  options: WorkflowRoomRuntimeProjectionOptions = {},
): WorkflowRoomSnapshot {
  return events.reduce(
    (current, event) =>
      workflowRoomSnapshotWithRuntimeEvent(current, event, options),
    snapshot,
  );
}

function applyRuntimeEventProjection(input: {
  event: WorkflowRoomRuntimeEvent;
  options: WorkflowRoomRuntimeProjectionOptions;
  roomEvent: WorkflowRoomEvent;
  snapshot: WorkflowRoomSnapshot;
  timestamp: string;
}): WorkflowRoomSnapshot {
  const next = {
    ...input.snapshot,
    events: [...input.snapshot.events, input.roomEvent],
    updatedAt: input.timestamp,
  };
  const withRun = applyWorkflowRunLink(next, input.event, input.options);
  const withApproval = applyApprovalProjection(
    withRun,
    input.event,
    input.timestamp,
  );
  return applyArtifactProjection(withApproval, input.event, input.timestamp);
}

function applyWorkflowRunLink(
  snapshot: WorkflowRoomSnapshot,
  event: WorkflowRoomRuntimeEvent,
  options: WorkflowRoomRuntimeProjectionOptions,
): WorkflowRoomSnapshot {
  const runLink = workflowRoomRunLinkFromRuntimeEvent(event, options);
  if (!runLink) return snapshot;
  return {
    ...snapshot,
    workflowRuns: upsertRunLink(snapshot.workflowRuns, runLink),
  };
}

function applyApprovalProjection(
  snapshot: WorkflowRoomSnapshot,
  event: WorkflowRoomRuntimeEvent,
  timestamp: string,
): WorkflowRoomSnapshot {
  if (event.type === "approval.requested") {
    return {
      ...snapshot,
      handRaises: upsertById(
        snapshot.handRaises,
        approvalHandRaiseFromRequest(event, timestamp),
      ),
    };
  }
  if (event.type !== "approval.resolved") return snapshot;
  const status = event.decision === "approve" ? "resolved" : "dismissed";
  const decision = approvalDecisionFromResolution(event, timestamp);
  return {
    ...snapshot,
    decisions: upsertById(snapshot.decisions, decision),
    handRaises: snapshot.handRaises.map((handRaise) =>
      handRaise.id === event.requestId
        ? {
            ...handRaise,
            metadata: compactObject({
              ...handRaise.metadata,
              decision: event.decision,
              note: event.note,
            }),
            resolvedAt: timestamp,
            status,
          }
        : handRaise
    ),
  };
}

function applyArtifactProjection(
  snapshot: WorkflowRoomSnapshot,
  event: WorkflowRoomRuntimeEvent,
  timestamp: string,
): WorkflowRoomSnapshot {
  if (event.type !== "artifact.created") return snapshot;
  return {
    ...snapshot,
    artifacts: upsertById(
      snapshot.artifacts,
      roomArtifactFromRuntimeDescriptor(event.artifact, timestamp),
    ),
  };
}

function upsertRunLink(
  links: readonly WorkflowRoomRunLink[],
  runLink: WorkflowRoomRunLink,
): WorkflowRoomRunLink[] {
  const index = links.findIndex((candidate) =>
    (runLink.runId && candidate.runId === runLink.runId) ||
    candidate.id === runLink.id ||
    (
      isJsonObject(candidate.metadata) &&
      isJsonObject(runLink.metadata) &&
      candidate.metadata.toolId === runLink.metadata.toolId &&
      candidate.workflowId === runLink.workflowId
    )
  );
  if (index < 0) return [...links, runLink];
  const next = [...links];
  const previous = next[index]!;
  next[index] = {
    ...previous,
    ...runLink,
    createdAt: previous.createdAt ?? runLink.createdAt,
    metadata: compactObject({
      ...previous.metadata,
      ...runLink.metadata,
    }),
  };
  return next;
}

function upsertById<T extends { id: string }>(
  items: readonly T[],
  item: T,
): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

function nextRoomEventId(
  snapshot: WorkflowRoomSnapshot,
  prefix: string,
): string {
  return `${prefix}:event:${snapshot.events.length + 1}`;
}
