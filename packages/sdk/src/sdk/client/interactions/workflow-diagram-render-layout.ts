import type {
  WorkflowRenderModel,
  WorkflowRenderStatus,
} from "../workflow-render/index.js";
import type {
  WorkflowRunStepStatus,
} from "./workflow-run-projection.js";
import {
  childStepKey,
  semanticStatus,
  stepLabel,
} from "./workflow-diagram-format.js";
import type {
  WorkflowDiagramSnapshot,
} from "./workflow-diagram-types.js";

export function workflowRenderStatuses(snapshot: WorkflowDiagramSnapshot) {
  const statuses: Record<string, WorkflowRenderStatus | undefined> = {};
  for (const step of snapshot.steps) statuses[step.id] = workflowRenderStatus(step.status);
  for (const row of snapshot.transcript ?? []) {
    if (!row.itemWorkflowStepId) continue;
    statuses[row.itemWorkflowStepId] = workflowRenderStatus(semanticStatus(row.status));
  }
  return statuses;
}

export function workflowTerminalNodeDetails(snapshot: WorkflowDiagramSnapshot, activeStepId: string | undefined) {
  const details = new Map<string, {
    glyph?: string;
    label?: string;
    selected?: boolean;
    status?: string;
  }>();
  for (const step of snapshot.steps) {
    details.set(step.id, {
      glyph: step.boundary === "trigger" ? "●" : step.boundary === "end" ? "■" : step.childNodes?.length ? "◆" : "□",
      label: stepLabel(step).replace(/\s*<br\s*\/?>\s*/gi, " · "),
      selected: step.id === activeStepId,
      status: step.status,
    });
  }
  return details;
}

export function workflowRenderLayoutStepMaps(model: WorkflowRenderModel) {
  const layoutBoxIdByStepId: Record<string, string> = {};
  const stepIdByLayoutBoxId: Record<string, string> = {};
  const visit = (current: WorkflowRenderModel, prefix = "", parentStepId: string | undefined = undefined) => {
    for (const node of current.nodes) {
      const boxId = `${prefix}${node.id}`;
      const stepId = parentStepId ? childStepKey(parentStepId, node.id) : node.id;
      layoutBoxIdByStepId[stepId] = boxId;
      stepIdByLayoutBoxId[boxId] = stepId;
      if (node.childWorkflow) visit(node.childWorkflow.model, `${boxId}:child:`, node.id);
    }
  };
  visit(model);
  return { layoutBoxIdByStepId, stepIdByLayoutBoxId };
}

export function snapshotHasTopLevelStep(snapshot: WorkflowDiagramSnapshot, stepId: string) {
  return snapshot.steps.some((step) => step.id === stepId);
}

function workflowRenderStatus(status: WorkflowRunStepStatus): WorkflowRenderStatus {
  if (status === "done") return "completed";
  if (status === "failed") return "failed";
  if (status === "waiting") return "waiting";
  if (status === "pending" || status === "stale") return "pending";
  return "running";
}
