import type { LoopGraphProjection } from "../../core/index.js";
import type { WorkflowWorkspaceFrame } from "../../product/workflow-document/index.js";
import {
  projectWorkflowGraphRenderModel,
  type WorkflowRenderModel,
  type WorkflowRenderTerminalOutput,
} from "../workflow-render/index.js";
import {
  childStepKey,
} from "./workflow-diagram-format.js";
import {
  projectWorkflowViewSnapshotDiagram,
  workflowViewSnapshotFromRenderModel,
} from "./workflow-diagram-view-snapshot.js";
import {
  snapshotHasTopLevelStep,
  workflowRenderStatuses,
} from "./workflow-diagram-render-layout.js";
import type {
  WorkflowDiagramSnapshot,
} from "./workflow-diagram-types.js";

export type WorkflowDiagramDirection = "BT" | "LR" | "RL" | "TB" | "TD";

export type WorkflowDiagramPatchPreview = {
  addedStepIds?: string[];
  changedStepIds?: string[];
  removedStepIds?: string[];
};

export type WorkflowDiagramProjection = {
  activeEdge?: {
    from: string;
    to: string;
  };
  activeNode?: string;
  activeLayoutBox?: string;
  content: string;
  direction: WorkflowDiagramDirection;
  layoutBoxIdByStepId: Record<string, string>;
  nodeBgColors: Record<string, string>;
  nodeColors: Record<string, string>;
  nodeIdByStepId: Record<string, string>;
  renderModel: WorkflowRenderModel;
  stepIdByLayoutBoxId: Record<string, string>;
  stepIdByNodeId: Record<string, string>;
  terminal: WorkflowRenderTerminalOutput;
};

export function projectWorkflowGraphDiagram(input: {
  direction?: WorkflowDiagramDirection;
  graph: LoopGraphProjection;
  patchPreview?: WorkflowDiagramPatchPreview;
  selectedStepId?: string;
}): WorkflowDiagramProjection {
  const renderModel = projectWorkflowGraphRenderModel({
    graph: input.graph,
    ...(input.selectedStepId ? { selectedNodeId: input.selectedStepId } : {}),
  });
  return projectWorkflowViewSnapshotDiagram({
    direction: input.direction,
    patchPreview: input.patchPreview,
    selectedStepId: input.selectedStepId,
    snapshot: workflowViewSnapshotFromRenderModel(renderModel),
  });
}

export function workflowWorkspacePatchPreview(
  frame?: Pick<WorkflowWorkspaceFrame, "patches" | "proposal">,
): WorkflowDiagramPatchPreview | undefined {
  const patches = frame?.proposal?.patches.length ? frame.proposal.patches : frame?.patches;
  if (!patches?.length) return undefined;
  const addedStepIds = new Set<string>();
  const changedStepIds = new Set<string>();
  const removedStepIds = new Set<string>();

  for (const record of patches) {
    if (record.target !== "document") continue;
    const path = record.patch.path || "";
    if (!path.startsWith("/nodes")) continue;
    const stepIds = stepIdsFromNodePatchValue(record.patch.value);
    if (record.patch.op === "remove") {
      for (const id of stepIds) removedStepIds.add(id);
      continue;
    }
    if (record.patch.op === "add") {
      for (const id of stepIds) addedStepIds.add(id);
      continue;
    }
    if (record.patch.op === "replace") {
      const target = path.match(/^\/nodes\/([^/]+)/)?.[1];
      for (const id of stepIds) {
        if (target === undefined || target === "-" || /^\d+$/.test(target)) {
          addedStepIds.add(id);
        } else {
          changedStepIds.add(id);
        }
      }
    }
  }

  const preview: WorkflowDiagramPatchPreview = {};
  if (addedStepIds.size > 0) preview.addedStepIds = [...addedStepIds];
  if (changedStepIds.size > 0) preview.changedStepIds = [...changedStepIds];
  if (removedStepIds.size > 0) preview.removedStepIds = [...removedStepIds];
  return Object.keys(preview).length > 0 ? preview : undefined;
}

export function projectWorkflowDiagram(input: {
  direction?: WorkflowDiagramDirection;
  patchPreview?: WorkflowDiagramPatchPreview;
  selectedStepId?: string;
  snapshot: WorkflowDiagramSnapshot;
}): WorkflowDiagramProjection {
  const activeStepId = input.selectedStepId ?? activeStepIdFromSnapshot(input.snapshot);
  const renderModel = projectWorkflowGraphRenderModel({
    graph: input.snapshot.graph,
    ...(activeStepId && snapshotHasTopLevelStep(input.snapshot, activeStepId) ? { selectedNodeId: activeStepId } : {}),
    statuses: workflowRenderStatuses(input.snapshot),
  });
  return projectWorkflowViewSnapshotDiagram({
    direction: input.direction,
    patchPreview: input.patchPreview,
    selectedStepId: activeStepId,
    snapshot: workflowViewSnapshotFromRenderModel(renderModel),
  });
}

function activeStepIdFromSnapshot(snapshot: WorkflowDiagramSnapshot) {
  const runningChild = [...(snapshot.transcript ?? [])].reverse().find((row) =>
    row.status === "running" && row.itemWorkflowStepId && row.parentStepId
  );
  if (runningChild) return childStepKey(runningChild.parentStepId!, runningChild.itemWorkflowStepId!);
  return snapshot.currentStepId;
}

function stepIdsFromNodePatchValue(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(stepIdsFromNodePatchValue);
  }
  if (typeof value !== "object") return [];
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? [id] : [];
}
