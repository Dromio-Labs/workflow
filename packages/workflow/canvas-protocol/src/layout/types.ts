import type { WorkflowRenderLoop, WorkflowRenderNodeKind } from "../render.js";
import type { WorkflowRenderEdgeSemantic } from "../semantics.js";

export type WorkflowRenderLayoutDirection = "LR" | "TB";

export type WorkflowRenderLayoutSize = {
  height: number;
  width: number;
};

export type WorkflowRenderLayoutPoint = {
  x: number;
  y: number;
};

export type WorkflowRenderLayoutProfile = {
  child: {
    groupGap: number;
    headerHeight: number;
    loopInset: number;
    padding: number;
  };
  direction: WorkflowRenderLayoutDirection;
  gap: WorkflowRenderLayoutPoint;
  minCanvasSize: WorkflowRenderLayoutSize;
  nodeSize: WorkflowRenderLayoutSize;
  routeClearance: number;
  start: WorkflowRenderLayoutPoint;
};

export type WorkflowRenderNodeMeasurements = Readonly<Record<string, WorkflowRenderLayoutSize>>;

export type WorkflowRenderLayoutBoxKind = WorkflowRenderNodeKind | "child-group" | "loop-group";

export type WorkflowRenderLayoutBox = WorkflowRenderLayoutPoint & WorkflowRenderLayoutSize & {
  childWorkflowId?: string;
  id: string;
  kind: WorkflowRenderLayoutBoxKind;
  label: string;
  loopId?: string;
  loops?: WorkflowRenderLoop[];
  modelId: string;
  parentId?: string;
  sourceNodeId?: string;
  zIndex: number;
};

export type WorkflowRenderLayoutEdgeKind = "composition" | "fork" | "join" | "loop" | "merge" | "route" | "sequence";

export type WorkflowRenderLayoutEdge = {
  id: string;
  kind: WorkflowRenderLayoutEdgeKind;
  label?: string;
  points: WorkflowRenderLayoutPoint[];
  semantic: WorkflowRenderEdgeSemantic;
  sourceBoxId: string;
  targetBoxId: string;
};

export type WorkflowRenderLayout = WorkflowRenderLayoutSize & {
  boxes: WorkflowRenderLayoutBox[];
  edges: WorkflowRenderLayoutEdge[];
  profile: WorkflowRenderLayoutProfile;
};
