import {
  computeWorkflowRenderLayout,
  type WorkflowRenderLayout,
  type WorkflowRenderLayoutProfile,
  type WorkflowRenderModel,
} from "../workflow-render/index.js";
import type { WorkflowFieldSvgVariant } from "./types.js";

export const workflowFieldLayoutProfile: WorkflowRenderLayoutProfile = {
  child: {
    groupGap: 82,
    headerHeight: 28,
    loopInset: 24,
    padding: 32,
  },
  direction: "LR",
  gap: { x: 126, y: 88 },
  minCanvasSize: { height: 620, width: 1120 },
  nodeSize: { height: 22, width: 22 },
  routeClearance: 18,
  start: { x: 100, y: 70 },
};

export const workflowFieldMiniLayoutProfile: WorkflowRenderLayoutProfile = {
  child: {
    groupGap: 36,
    headerHeight: 18,
    loopInset: 12,
    padding: 16,
  },
  direction: "LR",
  gap: { x: 72, y: 40 },
  minCanvasSize: { height: 96, width: 560 },
  nodeSize: { height: 18, width: 18 },
  routeClearance: 10,
  start: { x: 50, y: 34 },
};

export function workflowFieldLayout(
  model: WorkflowRenderModel,
  variant: WorkflowFieldSvgVariant = "full",
): WorkflowRenderLayout {
  return computeWorkflowRenderLayout(
    variant === "mini" ? compactModel(model) : model,
    variant === "mini" ? workflowFieldMiniLayoutProfile : workflowFieldLayoutProfile,
  );
}

export function workflowFieldModel(
  model: WorkflowRenderModel,
  variant: WorkflowFieldSvgVariant = "full",
): WorkflowRenderModel {
  return variant === "mini" ? compactModel(model) : model;
}

function compactModel(model: WorkflowRenderModel): WorkflowRenderModel {
  return {
    ...model,
    nodes: model.nodes.map((node) => {
      if (!node.childWorkflow) return node;
      return {
        ...node,
        childWorkflow: {
          ...node.childWorkflow,
          model: withoutChildWorkflows(node.childWorkflow.model),
        },
      };
    }),
  };
}

function withoutChildWorkflows(model: WorkflowRenderModel): WorkflowRenderModel {
  return {
    ...model,
    nodes: model.nodes.map((node) => {
      const { childWorkflow: _childWorkflow, ...compactNode } = node;
      return compactNode;
    }),
  };
}
