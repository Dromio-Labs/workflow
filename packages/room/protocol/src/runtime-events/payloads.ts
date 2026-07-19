import type {
  JsonObject,
} from "../json.js";
import type {
  WorkflowRoomArtifact,
  WorkflowRoomDecision,
  WorkflowRoomHandRaise,
} from "../room.js";
import {
  toolIdFromRuntimeEvent,
  runIdFromRuntimeEvent,
  workflowIdFromRuntimeToolId,
} from "./metadata.js";
import {
  compactObject,
  jsonValue,
  jsonObjectOrUndefined,
} from "./json.js";
import type {
  ProjectedWorkflowRoomRuntimeProgressEvent,
  WorkflowRoomRuntimeApprovalEvent,
  WorkflowRoomRuntimeArtifactDescriptor,
  WorkflowRoomRuntimeChangeDescriptor,
  WorkflowRoomRuntimeDiagnosticDescriptor,
  WorkflowRoomRuntimeEvent,
  WorkflowRoomRuntimeProjectionOptions,
  WorkflowRoomRuntimeSourceDescriptor,
} from "./types.js";

export function workflowRoomRuntimeEventPayload(
  event: WorkflowRoomRuntimeEvent,
  options: WorkflowRoomRuntimeProjectionOptions,
): JsonObject {
  switch (event.type) {
    case "artifact.created":
      return { artifact: artifactPayload(event.artifact) };
    case "approval.requested":
      return compactObject({
        toolId: event.toolId,
        requestId: event.requestId,
        runId: event.runId ?? options.roomRunId,
        summary: event.summary,
        workflowId: event.workflowId ?? options.workflowId,
      });
    case "approval.resolved":
      return compactObject({
        decision: event.decision,
        note: event.note,
        requestId: event.requestId,
        runId: event.runId ?? options.roomRunId,
        workflowId: event.workflowId ?? options.workflowId,
      });
    case "tool.completed":
      return compactObject({
        toolId: event.toolId,
        output: jsonValue(event.output),
        runId: event.runId ?? options.roomRunId,
        workflowId: event.workflowId ??
          options.workflowId ??
          workflowIdFromRuntimeToolId(event.toolId),
      });
    case "tool.failed":
      return compactObject({
        toolId: event.toolId,
        error: event.error,
        runId: event.runId ?? options.roomRunId,
        workflowId: event.workflowId ??
          options.workflowId ??
          workflowIdFromRuntimeToolId(event.toolId),
      });
    case "tool.started":
      return compactObject({
        toolId: event.toolId,
        input: jsonValue(event.input),
        runId: event.runId ?? options.roomRunId,
        workflowId: event.workflowId ??
          options.workflowId ??
          workflowIdFromRuntimeToolId(event.toolId),
      });
    case "change.recorded":
      return { change: descriptorPayload(event.change) };
    case "diagnostic.recorded":
      return { diagnostic: descriptorPayload(event.diagnostic) };
    case "source.recorded":
      return { source: descriptorPayload(event.source) };
    case "workflow.event":
      return compactObject({
        event: jsonValue(event.event),
        runId: runIdFromRuntimeEvent(event) ?? options.roomRunId,
        workflowId: event.workflowId,
      });
    default:
      return progressPayload(event, options);
  }
}

export function progressPayload(
  event: ProjectedWorkflowRoomRuntimeProgressEvent,
  options: WorkflowRoomRuntimeProjectionOptions,
): JsonObject {
  return compactObject({
    detail: jsonValue(event.detail),
    index: event.index,
    message: event.message,
    runId: event.runId ?? options.roomRunId,
    stepId: event.stepId,
    trace: jsonObjectOrUndefined(event.trace),
    workflowId: event.workflowId ?? options.workflowId,
  });
}

export function roomArtifactFromRuntimeDescriptor(
  artifact: WorkflowRoomRuntimeArtifactDescriptor,
  timestamp: string,
): WorkflowRoomArtifact {
  return {
    content: artifactPayload(artifact),
    createdAt: timestamp,
    id: artifact.id,
    status: "proposed",
    title: artifact.title,
    type: artifact.kind,
    updatedAt: timestamp,
  };
}

export function artifactPayload(
  artifact: WorkflowRoomRuntimeArtifactDescriptor,
): JsonObject {
  return compactObject({
    content: jsonValue(artifact.content),
    kind: artifact.kind,
    metadata: jsonValue(artifact.metadata),
    mimeType: artifact.mimeType,
    summary: artifact.summary,
    title: artifact.title,
    uri: artifact.uri,
  });
}

export function descriptorPayload(
  descriptor:
    | WorkflowRoomRuntimeChangeDescriptor
    | WorkflowRoomRuntimeDiagnosticDescriptor
    | WorkflowRoomRuntimeSourceDescriptor,
): JsonObject {
  return jsonValue(descriptor) as JsonObject;
}

export function approvalHandRaiseFromRequest(
  event: Extract<
    WorkflowRoomRuntimeApprovalEvent,
    { type: "approval.requested" }
  >,
  timestamp: string,
): WorkflowRoomHandRaise {
  return {
    createdAt: timestamp,
    id: event.requestId,
    metadata: compactObject({
      toolId: event.toolId,
      requestId: event.requestId,
      runId: event.runId,
      workflowId: event.workflowId,
    }),
    priority: "normal",
    question: event.summary,
    reason: "approval",
    status: "open",
  };
}

export function approvalDecisionFromResolution(
  event: Extract<
    WorkflowRoomRuntimeApprovalEvent,
    { type: "approval.resolved" }
  >,
  timestamp: string,
): WorkflowRoomDecision {
  return {
    content: compactObject({
      decision: event.decision,
      note: event.note,
      requestId: event.requestId,
      runId: event.runId,
      workflowId: event.workflowId,
    }),
    createdAt: timestamp,
    id: `approval:${event.requestId}`,
    title: event.decision === "approve"
      ? "Approval granted"
      : "Approval rejected",
  };
}

export function toolPayloadMetadata(
  event: WorkflowRoomRuntimeEvent,
): JsonObject {
  return compactObject({
    toolId: toolIdFromRuntimeEvent(event),
  });
}
