import type { JsonObject, JsonValue } from "./json.js";
import type { WorkflowHookRequest } from "./hooks.js";

export type WorkflowRunStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "paused"
  | "pending"
  | "running"
  | "skipped"
  | "waiting"
  | string;

export type WorkflowRunEvent = {
  detail?: JsonValue;
  id?: string;
  index?: number;
  message?: string;
  runId: string;
  stepId?: string;
  timestamp?: string;
  trace?: JsonObject;
  type: string;
  workflowId?: string;
};

export type WorkflowRunSnapshot = {
  checkpoints?: JsonValue[];
  events: WorkflowRunEvent[];
  input?: JsonValue;
  output?: JsonValue;
  pendingHooks: WorkflowHookRequest[];
  pendingQuestions?: JsonValue[];
  result?: JsonValue;
  runId: string;
  state?: JsonObject;
  status: WorkflowRunStatus;
  workflowId?: string;
  workflowKey?: string;
};
