export type WorkflowRoomRuntimeToolEvent =
  | {
      toolId: string;
      input?: unknown;
      runId?: string;
      timestamp?: string;
      type: "tool.started";
      workflowId?: string;
    }
  | {
      toolId: string;
      output?: unknown;
      runId?: string;
      timestamp?: string;
      type: "tool.completed";
      workflowId?: string;
    }
  | {
      toolId: string;
      error: string;
      runId?: string;
      timestamp?: string;
      type: "tool.failed";
      workflowId?: string;
    };

export type WorkflowRoomRuntimeApprovalEvent =
  | {
      toolId?: string;
      requestId: string;
      runId?: string;
      summary: string;
      timestamp?: string;
      type: "approval.requested";
      workflowId?: string;
    }
  | {
      decision: "approve" | "reject";
      note?: string;
      requestId: string;
      runId?: string;
      timestamp?: string;
      type: "approval.resolved";
      workflowId?: string;
    };

export type WorkflowRoomRuntimeArtifactDescriptor = {
  content?: unknown;
  id: string;
  kind: string;
  metadata?: unknown;
  mimeType?: string;
  summary?: string;
  title: string;
  uri?: string;
};

export type WorkflowRoomRuntimeChangeDescriptor = {
  diff?: string;
  id: string;
  kind: string;
  metadata?: unknown;
  summary?: string;
  target?: string;
  title: string;
};

export type WorkflowRoomRuntimeDiagnosticDescriptor = {
  id: string;
  message?: string;
  metadata?: unknown;
  severity: "error" | "info" | "warning";
  source?: string;
  title: string;
};

export type WorkflowRoomRuntimeSourceDescriptor = {
  faviconUrl?: string;
  id: string;
  kind: string;
  metadata?: unknown;
  summary?: string;
  title: string;
  uri?: string;
};

export type WorkflowRoomRuntimeWorkbenchEvent =
  | {
      artifact: WorkflowRoomRuntimeArtifactDescriptor;
      timestamp?: string;
      type: "artifact.created";
      workflowId?: string;
    }
  | {
      change: WorkflowRoomRuntimeChangeDescriptor;
      timestamp?: string;
      type: "change.recorded";
      workflowId?: string;
    }
  | {
      diagnostic: WorkflowRoomRuntimeDiagnosticDescriptor;
      timestamp?: string;
      type: "diagnostic.recorded";
      workflowId?: string;
    }
  | {
      source: WorkflowRoomRuntimeSourceDescriptor;
      timestamp?: string;
      type: "source.recorded";
      workflowId?: string;
    };

export type WorkflowRoomRuntimeWorkflowEvent = {
  event: unknown;
  runId?: string;
  timestamp?: string;
  type: "workflow.event";
  workflowId: string;
};

export type WorkflowRoomRuntimeProgressEventType =
  | `checkpoint.${string}`
  | `model.${string}`
  | `operation.${string}`
  | `run.${string}`
  | `step.${string}`
  | `workflow.end.${string}`;

export type WorkflowRoomRuntimeProgressEvent = {
  attempt?: number;
  correlationId?: string;
  detail?: unknown;
  index?: number;
  message?: string;
  runId?: string;
  stepId?: string;
  timestamp?: string;
  trace?: unknown;
  type: WorkflowRoomRuntimeProgressEventType;
  workflowId?: string;
};

export type ProjectedWorkflowRoomRuntimeProgressEvent =
  Omit<WorkflowRoomRuntimeProgressEvent, "type"> & { type: string };

export type WorkflowRoomRuntimeEvent =
  | WorkflowRoomRuntimeApprovalEvent
  | WorkflowRoomRuntimeToolEvent
  | WorkflowRoomRuntimeWorkbenchEvent
  | WorkflowRoomRuntimeWorkflowEvent
  | WorkflowRoomRuntimeProgressEvent;

export type WorkflowRoomRuntimeProjectionOptions = {
  actorParticipantId?: string;
  id?: string;
  idPrefix?: string;
  now?: () => string;
  roomRunId?: string;
  workflowId?: string;
};
