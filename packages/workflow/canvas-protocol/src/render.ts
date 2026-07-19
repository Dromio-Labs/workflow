import type { DromioJsonObject } from "@dromio/protocols";
import type {
  WorkflowRenderEdgeSemantic,
  WorkflowRenderNodeSemantic,
} from "./semantics.js";

export type WorkflowRenderNodeKind = "end" | "group" | "initial" | "step" | "trigger" | "workflow";

export type WorkflowRenderStatus =
  | "completed"
  | "failed"
  | "pending"
  | "running"
  | "skipped"
  | "waiting";

export type WorkflowRenderPort = {
  id: string;
  key?: string;
  label?: string;
  type: "source" | "target";
};

export type WorkflowRenderChildWorkflow = {
  description?: string;
  execution?: {
    itemLabelPath?: string;
    itemSource?: string;
    joinPolicy?: "all" | "any";
    kind?: string;
    label?: string;
  };
  id: string;
  label: string;
  model: WorkflowRenderModel;
};

export type WorkflowRenderNode = {
  catalogItemId?: string;
  childWorkflow?: WorkflowRenderChildWorkflow;
  childWorkflowId?: string;
  description?: string;
  id: string;
  kind: WorkflowRenderNodeKind;
  label: string;
  metadata: DromioJsonObject;
  parentId?: string;
  ports: WorkflowRenderPort[];
  semantic: WorkflowRenderNodeSemantic;
  status?: WorkflowRenderStatus;
};

export type WorkflowRenderEdge = {
  id: string;
  label?: string;
  metadata: DromioJsonObject;
  semantic: WorkflowRenderEdgeSemantic;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
};

export type WorkflowRenderLoop = {
  backTo?: string;
  end: string;
  id: string;
  label?: string;
  start: string;
};

export type WorkflowRenderModel = {
  description?: string;
  edges: WorkflowRenderEdge[];
  id: string;
  label: string;
  loops: WorkflowRenderLoop[];
  nodes: WorkflowRenderNode[];
  readOnly: boolean;
  selectedNodeId?: string;
  warnings: string[];
};
