import type { JsonObject } from "./json.js";
import type { WorkflowViewCapabilities } from "./capabilities.js";
import type { WorkflowViewCommandResult } from "./commands.js";
import type { WorkflowHookRequest } from "./hooks.js";
import type { WorkflowRenderModel } from "@dromio/workflow-canvas-protocol";
import type { WorkflowResultPresentation } from "./result.js";
import type { WorkflowRoomSnapshot } from "./room.js";
import type { WorkflowRunSnapshot } from "./run.js";

export type WorkflowViewValidationIssue = {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
};

export type WorkflowViewSnapshot = {
  capabilities: WorkflowViewCapabilities;
  commandResults?: WorkflowViewCommandResult[];
  generatedAt?: string;
  metadata?: JsonObject;
  pendingHooks: WorkflowHookRequest[];
  render: WorkflowRenderModel;
  result?: WorkflowResultPresentation;
  room?: WorkflowRoomSnapshot;
  run?: WorkflowRunSnapshot;
  selectedNodeId?: string;
  validation?: {
    issues: WorkflowViewValidationIssue[];
    renderable: boolean;
  };
  version: "workflow-view/v1";
};
