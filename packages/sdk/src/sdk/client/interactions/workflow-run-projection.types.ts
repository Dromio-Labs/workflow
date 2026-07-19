import type {
  LoopGraphCatalogItem,
  LoopGraphChildNode,
  LoopGraphPort,
  LoopGraphProjection,
  Question,
} from "../../core/index.js";

export type WorkflowRunStepStatus =
  | "done"
  | "failed"
  | "looped"
  | "pending"
  | "retrying"
  | "revisiting"
  | "running"
  | "stale"
  | "waiting";

export type WorkflowRunStepView = {
  attempt?: number;
  boundary?: "end" | "trigger";
  catalog?: LoopGraphCatalogItem;
  catalogItemId?: string;
  childNodes?: LoopGraphChildNode[];
  description?: string;
  id: string;
  input?: LoopGraphPort[];
  index: number;
  label: string;
  models?: WorkflowRunStepModelView[];
  note?: string;
  output?: LoopGraphPort[];
  runtimeInput?: unknown;
  runtimeOutput?: unknown;
  score?: number;
  status: WorkflowRunStepStatus;
  triggerType?: string;
};

export type WorkflowRunStepModelView = {
  label?: string;
  operation: string;
  prompt?: WorkflowRunStepPromptView;
  requested?: WorkflowRunModelView;
  selected?: WorkflowRunModelView;
};

export type WorkflowRunStepPromptView =
  | {
      kind: "file";
      path: string;
    }
  | {
      kind: "loader";
    }
  | {
      kind: "text";
      preview: string;
    };

export type WorkflowRunModelView = {
  capabilities?: string[];
  id: string;
  label?: string;
  model?: string;
  worker?: string;
};

export type WorkflowRunLoopView = {
  fromStepId: string;
  reason?: string;
  targetStepId: string;
};

export type WorkflowRunActivityView = {
  message: string;
  status: "error" | "info" | "ok" | "running" | "waiting";
  stepId?: string;
  type: string;
};

export type WorkflowRunProjection = {
  activity: WorkflowRunActivityView[];
  currentStep?: WorkflowRunStepView;
  currentStepId?: string;
  graph: LoopGraphProjection;
  input?: unknown;
  loops: WorkflowRunLoopView[];
  pendingQuestions: Question[];
  runId?: string;
  state: Record<string, unknown>;
  status: "completed" | "failed" | "idle" | "running" | "waiting";
  steps: WorkflowRunStepView[];
};
