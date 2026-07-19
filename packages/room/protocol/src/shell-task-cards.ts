import {
  workflowHookToJsonRenderDocument,
} from "./hooks.js";
import {
  isJsonObject,
  type JsonObject,
} from "./json.js";
import type {
  WorkflowJsonRenderDocument,
} from "./json-render.js";
import type {
  WorkflowRoomArtifact,
  WorkflowRoomEvent,
  WorkflowRoomRunLink,
  WorkflowRoomSnapshot,
} from "./room.js";
import {
  workflowHookRequestsFromRoomHandRaises,
} from "./room-state.js";

export type WorkflowRoomShellTaskCardKind =
  | "approval"
  | "artifact"
  | "change"
  | "diagnostic"
  | "source"
  | "workflow";

export type WorkflowRoomShellTaskCard = {
  artifactId?: string;
  createdAt?: string;
  detail: string;
  id: string;
  kind: WorkflowRoomShellTaskCardKind;
  metadata?: JsonObject;
  render?: WorkflowJsonRenderDocument;
  runId?: string;
  sourceEventId?: string;
  status: string;
  title: string;
  updatedAt?: string;
  workflowId?: string;
};

export function workflowRoomShellTaskCardsFromSnapshot(
  snapshot: WorkflowRoomSnapshot,
): WorkflowRoomShellTaskCard[] {
  return [
    ...snapshot.workflowRuns.map(workflowRunCard),
    ...approvalTaskCards(snapshot),
    ...snapshot.artifacts.map(artifactTaskCard),
    ...snapshot.events.flatMap(eventTaskCards),
  ];
}

function workflowRunCard(run: WorkflowRoomRunLink): WorkflowRoomShellTaskCard {
  const toolId = stringValue(run.metadata?.toolId);
  const detail = [
    run.runId ? `run ${run.runId}` : undefined,
    run.executionId ? `execution ${run.executionId}` : undefined,
    toolId,
  ].filter((item): item is string => Boolean(item)).join(" · ");
  return {
    createdAt: run.createdAt,
    detail: detail || "Workflow run linked",
    id: `workflow-run:${run.id}`,
    kind: "workflow",
    metadata: run.metadata,
    runId: run.runId,
    status: run.status,
    title: `Workflow ${run.workflowId}`,
    updatedAt: run.updatedAt,
    workflowId: run.workflowId,
  };
}

function approvalTaskCards(
  snapshot: WorkflowRoomSnapshot,
): WorkflowRoomShellTaskCard[] {
  const hooks = workflowHookRequestsFromRoomHandRaises(snapshot.handRaises, {
    fallbackRunId: snapshot.workflowRuns[0]?.runId ?? snapshot.workflowRuns[0]?.id,
    fallbackWorkflowId: snapshot.workflowRuns[0]?.workflowId,
    idPrefix: "shell.",
    tokenPrefix: "shell:",
  });
  const hookByHandRaiseId = new Map(
    hooks.map((hook) => [hook.id.replace(/^shell\./, ""), hook]),
  );
  return snapshot.handRaises.map((handRaise) => {
    const hook = hookByHandRaiseId.get(handRaise.id);
    return {
      createdAt: handRaise.createdAt,
      detail: [handRaise.reason, handRaise.priority]
        .filter((item): item is string => Boolean(item))
        .join(" · ") || "Human attention requested",
      id: `approval:${handRaise.id}`,
      kind: "approval",
      metadata: handRaise.metadata,
      render: hook ? workflowHookToJsonRenderDocument(hook) : undefined,
      status: handRaise.status,
      title: handRaise.question,
      updatedAt: handRaise.resolvedAt,
      workflowId: stringValue(handRaise.metadata?.workflowId),
    };
  });
}

function artifactTaskCard(
  artifact: WorkflowRoomArtifact,
): WorkflowRoomShellTaskCard {
  return {
    artifactId: artifact.id,
    createdAt: artifact.createdAt,
    detail: artifact.type,
    id: `artifact:${artifact.id}`,
    kind: "artifact",
    metadata: isJsonObject(artifact.content) ? artifact.content : undefined,
    status: artifact.status,
    title: artifact.title,
    updatedAt: artifact.updatedAt,
  };
}

function eventTaskCards(event: WorkflowRoomEvent): WorkflowRoomShellTaskCard[] {
  switch (event.kind) {
    case "change.recorded":
      return [descriptorEventCard(event, "change")];
    case "diagnostic.recorded":
      return [descriptorEventCard(event, "diagnostic")];
    case "source.recorded":
      return [descriptorEventCard(event, "source")];
    case "workflow.event":
      return [workflowEventCard(event)];
    default:
      return event.kind === "tool.failed"
        ? [toolFailureCard(event)]
        : [];
  }
}

function descriptorEventCard(
  event: WorkflowRoomEvent,
  kind: "change" | "diagnostic" | "source",
): WorkflowRoomShellTaskCard {
  const descriptor = descriptorPayload(event.payload, kind);
  return {
    createdAt: event.createdAt,
    detail: stringValue(descriptor.summary) ??
      stringValue(descriptor.message) ??
      stringValue(descriptor.source) ??
      `${Object.keys(descriptor).length} fields`,
    id: `${kind}:${event.id}`,
    kind,
    metadata: descriptor,
    sourceEventId: event.id,
    status: stringValue(descriptor.severity) ??
      stringValue(descriptor.kind) ??
      kind,
    title: stringValue(descriptor.title) ?? event.kind,
    workflowId: stringValue(event.payload.workflowId),
  };
}

function workflowEventCard(event: WorkflowRoomEvent): WorkflowRoomShellTaskCard {
  const workflowEvent = isJsonObject(event.payload.event)
    ? event.payload.event
    : {};
  const workflowId = stringValue(event.payload.workflowId) ?? "workflow";
  return {
    createdAt: event.createdAt,
    detail: stringValue(workflowEvent.message) ??
      stringValue(workflowEvent.description) ??
      summarizeRecord(workflowEvent),
    id: `workflow-event:${event.id}`,
    kind: "workflow",
    metadata: workflowEvent,
    runId: stringValue(event.payload.runId),
    sourceEventId: event.id,
    status: stringValue(workflowEvent.status) ??
      stringValue(workflowEvent.type) ??
      "event",
    title: stringValue(workflowEvent.title) ??
      stringValue(workflowEvent.summary) ??
      workflowId,
    workflowId,
  };
}

function toolFailureCard(
  event: WorkflowRoomEvent,
): WorkflowRoomShellTaskCard {
  return {
    createdAt: event.createdAt,
    detail: stringValue(event.payload.error) ?? "Tool failed",
    id: `tool-failed:${event.id}`,
    kind: "workflow",
    metadata: event.payload,
    runId: stringValue(event.payload.runId),
    sourceEventId: event.id,
    status: "failed",
    title: stringValue(event.payload.toolId) ?? "Tool failed",
    workflowId: stringValue(event.payload.workflowId),
  };
}

function descriptorPayload(
  payload: JsonObject,
  key: "change" | "diagnostic" | "source",
): JsonObject {
  const descriptor = payload[key];
  return isJsonObject(descriptor) ? descriptor : {};
}

function summarizeRecord(record: JsonObject): string {
  const count = Object.keys(record).length;
  return count === 0 ? "Workflow event" : `${count} fields`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
