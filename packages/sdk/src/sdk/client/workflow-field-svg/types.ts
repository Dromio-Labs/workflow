import type {
  WorkflowRenderModel,
  WorkflowRenderStatus,
} from "../workflow-render/index.js";

export type WorkflowFieldEvent = {
  attempt?: number;
  detail?: unknown;
  message?: string;
  stepId?: string;
  timestamp?: string;
  type: string;
};

export type WorkflowFieldRunInput = {
  events: readonly WorkflowFieldEvent[];
  status: string;
  triggerId?: string;
};

export type WorkflowFieldVisualState = {
  activeNodeId?: string;
  activeNodeIds: readonly string[];
  elapsedMs: number;
  evaluation?: WorkflowFieldEvaluationState;
  phase: "completed" | "failed" | "idle" | "running" | "waiting";
  statuses: Readonly<Record<string, WorkflowRenderStatus>>;
  waitingKind?: "human" | "signal";
  waitingLabel?: string;
};

export type WorkflowFieldEvaluationState = {
  attempt?: number;
  nodeId: string;
  score: number;
  status: string;
  threshold: number;
};

export type WorkflowFieldSvgVariant = "full" | "mini";

export type WorkflowFieldSvgInput = {
  model: WorkflowRenderModel;
  run?: WorkflowFieldRunInput;
  variant?: WorkflowFieldSvgVariant;
};

export type WorkflowFieldSvgRenderer = {
  dispose(): void;
  update(input: WorkflowFieldSvgInput): void;
};

export type WorkflowFieldSvgScene = {
  dispose(): void;
  update(now: number, deltaSeconds: number): void;
};

export type WorkflowFieldSvgGraphScene = WorkflowFieldSvgScene & {
  setState(state: WorkflowFieldVisualState): void;
};
