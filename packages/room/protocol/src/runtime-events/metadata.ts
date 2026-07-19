import {
  numberValue,
  recordValue,
  stringValue,
} from "./json.js";
import type {
  ProjectedWorkflowRoomRuntimeProgressEvent,
  WorkflowRoomRuntimeEvent,
  WorkflowRoomRuntimeProgressEvent,
} from "./types.js";

export function runtimeProgressEvent(
  event: WorkflowRoomRuntimeEvent,
): ProjectedWorkflowRoomRuntimeProgressEvent | undefined {
  if (event.type === "workflow.event") {
    const record = recordValue(event.event);
    if (!record) {
      return {
        detail: event.event,
        runId: event.runId,
        timestamp: event.timestamp,
        type: "workflow.event",
        workflowId: event.workflowId,
      };
    }
    return {
      attempt: numberValue(record.attempt),
      correlationId: stringValue(record.correlationId),
      detail: record.detail,
      index: numberValue(record.index),
      message: stringValue(record.message),
      runId: stringValue(record.runId) ?? event.runId,
      stepId: stringValue(record.stepId),
      timestamp: stringValue(record.timestamp) ?? event.timestamp,
      trace: record.trace,
      type: stringValue(record.type) ?? "workflow.event",
      workflowId: event.workflowId,
    };
  }
  if (isWorkflowRoomRuntimeProgressEvent(event)) return event;
  return undefined;
}

export function runStatusFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
): string | undefined {
  if (event.type === "tool.started") return "running";
  if (event.type === "tool.completed") return "completed";
  if (event.type === "tool.failed") return "failed";
  const progress = runtimeProgressEvent(event);
  if (!progress) return undefined;
  if (progress.type === "run.started" || progress.type === "run.resumed") {
    return "running";
  }
  if (progress.type === "run.completed") return "completed";
  if (progress.type === "run.failed") return "failed";
  if (progress.type === "run.cancelled") return "cancelled";
  if (progress.type === "run.paused") return "paused";
  if (progress.type === "step.waiting") return "waiting";
  return undefined;
}

export function workflowIdFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
): string | undefined {
  if (
    "workflowId" in event &&
    typeof event.workflowId === "string" &&
    event.workflowId.trim()
  ) {
    return event.workflowId;
  }
  const toolId = toolIdFromRuntimeEvent(event);
  return toolId ? workflowIdFromRuntimeToolId(toolId) : undefined;
}

export function runIdFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
): string | undefined {
  if (
    "runId" in event &&
    typeof event.runId === "string" &&
    event.runId.trim()
  ) {
    return event.runId;
  }
  if (event.type !== "workflow.event") return undefined;
  const record = recordValue(event.event);
  return record ? stringValue(record.runId) : undefined;
}

export function toolIdFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
): string | undefined {
  return "toolId" in event &&
    typeof event.toolId === "string" &&
    event.toolId.trim()
    ? event.toolId
    : undefined;
}

export function workflowIdFromRuntimeToolId(
  toolId: string,
): string | undefined {
  const match = toolId.match(/^workflow\.(.+)\.run$/);
  return match?.[1];
}

export function runtimeEventId(
  event: WorkflowRoomRuntimeEvent,
  prefix: string,
): string {
  const source = [
    stringValue(event.type),
    "index" in event ? numberValue(event.index)?.toString() : undefined,
    runIdFromRuntimeEvent(event),
    "requestId" in event ? stringValue(event.requestId) : undefined,
    toolIdFromRuntimeEvent(event),
  ].filter((value): value is string => Boolean(value));
  return [prefix, ...source].join(":");
}

export function eventTimestamp(
  event: WorkflowRoomRuntimeEvent,
): string | undefined {
  return "timestamp" in event ? stringValue(event.timestamp) : undefined;
}

function isProgressEventType(type: string): boolean {
  return type.startsWith("run.") ||
    type.startsWith("step.") ||
    type.startsWith("workflow.end.") ||
    type.startsWith("checkpoint.") ||
    type.startsWith("model.") ||
    type.startsWith("operation.");
}

function isWorkflowRoomRuntimeProgressEvent(
  event: WorkflowRoomRuntimeEvent,
): event is WorkflowRoomRuntimeProgressEvent {
  return isProgressEventType(event.type);
}
