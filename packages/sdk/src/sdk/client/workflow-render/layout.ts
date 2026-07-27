export {
  computeWorkflowRenderLayout,
  workflowRenderLayoutProfiles,
} from "@dromio/workflow-canvas-protocol";
import type {
  WorkflowRenderNodeMeasurements,
} from "@dromio/workflow-canvas-protocol";
import type {
  WorkflowRenderModel,
} from "./types.js";
export type {
  WorkflowRenderLayout,
  WorkflowRenderLayoutBox,
  WorkflowRenderLayoutBoxKind,
  WorkflowRenderLayoutDirection,
  WorkflowRenderLayoutEdge,
  WorkflowRenderLayoutEdgeKind,
  WorkflowRenderLayoutPoint,
  WorkflowRenderLayoutProfile,
  WorkflowRenderLayoutSize,
} from "@dromio/workflow-canvas-protocol";

export function workflowInitialNodeMeasurements(
  model: WorkflowRenderModel,
): WorkflowRenderNodeMeasurements {
  const measurements: Record<string, { height: number; width: number }> = {};
  for (const node of model.nodes) {
    if (node.kind === "initial") measurements[node.id] = { height: 24, width: 24 };
    if (node.childWorkflow) Object.assign(measurements, workflowInitialNodeMeasurements(node.childWorkflow.model));
  }
  return measurements;
}
