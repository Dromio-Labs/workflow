import {
  readOnlyWorkflowViewCapabilities,
  withWorkflowViewValidation,
  type WorkflowViewSnapshot,
} from "@dromio/workflow-room-protocol";
import {
  renderWorkflowLayoutToTerminal,
  workflowRenderSemanticLabel,
  type WorkflowRenderEdge,
  type WorkflowRenderModel,
  type WorkflowRenderNode,
  type WorkflowRenderStatus,
} from "../workflow-render/index.js";
import {
  projectWorkflowRenderModelToWorkflowRoom,
} from "../workflow-room/projection.js";
import {
  childStepKey,
  mermaidLabel,
} from "./workflow-diagram-format.js";
import {
  workflowRenderLayoutStepMaps,
} from "./workflow-diagram-render-layout.js";
import type {
  WorkflowDiagramDirection,
  WorkflowDiagramPatchPreview,
  WorkflowDiagramProjection,
} from "./workflow-diagram.js";

type DiagramBuildContext = {
  nodeIdByStepId: Record<string, string>;
  stepIdByNodeId: Record<string, string>;
  usedIds: Set<string>;
};

type DiagramNodeShape = "box" | "database" | "decision" | "rounded" | "subroutine";

const DIAGRAM_COLORS = {
  added: "#86efac",
  changed: "#fbbf24",
  done: "#86efac",
  failed: "#fca5a5",
  idle: "#d9e2f2",
  removed: "#fca5a5",
  running: "#8bd3ff",
  selectedBg: "#24243a",
  waiting: "#fbbf24",
} as const;

export function workflowViewSnapshotFromRenderModel(
  model: WorkflowRenderModel,
): WorkflowViewSnapshot {
  return withWorkflowViewValidation({
    capabilities: readOnlyWorkflowViewCapabilities,
    metadata: {
      source: "sdk.workflow-diagram",
    },
    pendingHooks: [],
    render: projectWorkflowRenderModelToWorkflowRoom(model),
    ...(model.selectedNodeId ? { selectedNodeId: model.selectedNodeId } : {}),
    version: "workflow-view/v1",
  });
}

export function projectWorkflowViewSnapshotDiagram(input: {
  direction?: WorkflowDiagramDirection;
  patchPreview?: WorkflowDiagramPatchPreview;
  selectedStepId?: string;
  snapshot: WorkflowViewSnapshot;
}): WorkflowDiagramProjection {
  const direction = input.direction ?? "TD";
  const model = input.snapshot.render as WorkflowRenderModel;
  const context: DiagramBuildContext = {
    nodeIdByStepId: {},
    stepIdByNodeId: {},
    usedIds: new Set(),
  };
  const nodeColors: Record<string, string> = {};
  const nodeBgColors: Record<string, string> = {};
  const activeStepId = input.selectedStepId ?? input.snapshot.selectedNodeId ?? model.selectedNodeId;
  const lines = [`flowchart ${direction}`];

  appendModelDiagram({
    activeStepId,
    context,
    lines,
    model,
    nodeBgColors,
    nodeColors,
    patchPreview: input.patchPreview,
  });

  const activeNode = activeStepId ? context.nodeIdByStepId[activeStepId] : undefined;
  const activeEdge = activeNode
    ? activeEdgeForNode(lines, activeNode)
    : undefined;
  const terminal = renderWorkflowLayoutToTerminal({
    model,
    nodeDetails: workflowTerminalNodeDetailsFromRenderModel(model, activeStepId),
    width: 96,
  });
  const layoutMaps = workflowRenderLayoutStepMaps(model);

  return {
    activeEdge,
    activeNode,
    ...(activeStepId && layoutMaps.layoutBoxIdByStepId[activeStepId]
      ? { activeLayoutBox: layoutMaps.layoutBoxIdByStepId[activeStepId] }
      : {}),
    content: lines.join("\n"),
    direction,
    layoutBoxIdByStepId: layoutMaps.layoutBoxIdByStepId,
    nodeBgColors,
    nodeColors,
    nodeIdByStepId: context.nodeIdByStepId,
    renderModel: model,
    stepIdByLayoutBoxId: layoutMaps.stepIdByLayoutBoxId,
    stepIdByNodeId: context.stepIdByNodeId,
    terminal,
  };
}

function appendModelDiagram(input: {
  activeStepId?: string;
  context: DiagramBuildContext;
  lines: string[];
  model: WorkflowRenderModel;
  nodeBgColors: Record<string, string>;
  nodeColors: Record<string, string>;
  parentStepId?: string;
  patchPreview?: WorkflowDiagramPatchPreview;
}) {
  for (const [index, node] of input.model.nodes.entries()) {
    appendRenderNode({
      ...input,
      childIndex: input.parentStepId ? modelStepIndex(input.model, node.id) : undefined,
      node,
    });
  }

  for (const edge of modelEdges(input.model)) {
    const from = input.context.nodeIdByStepId[stepKey(input.parentStepId, edge.source)];
    const to = input.context.nodeIdByStepId[stepKey(input.parentStepId, edge.target)];
    if (from && to) input.lines.push(`  ${edgeStatement(edge, from, to)}`);
  }

  for (const node of input.model.nodes) {
    if (!node.childWorkflow) continue;
    appendChildWorkflowDiagram({
      ...input,
      childWorkflow: node.childWorkflow,
      parentNode: node,
    });
  }
}

function appendRenderNode(input: {
  activeStepId?: string;
  childIndex?: number;
  context: DiagramBuildContext;
  lines: string[];
  node: WorkflowRenderNode;
  nodeBgColors: Record<string, string>;
  nodeColors: Record<string, string>;
  parentStepId?: string;
  patchPreview?: WorkflowDiagramPatchPreview;
}) {
  const stepId = stepKey(input.parentStepId, input.node.id);
  const nodeId = diagramNodeId(input.context, "wf", stepId, stepId);
  input.lines.push(`  ${nodeStatement(nodeId, renderNodeLabel(input.node, input.childIndex), renderNodeShape(input.node))}`);
  input.nodeColors[nodeId] = renderStatusColor(input.node.status);
  addPatchColor(input.nodeColors, nodeId, input.node.id, input.patchPreview);
  if (input.activeStepId === stepId || input.activeStepId === input.node.id) {
    input.nodeBgColors[nodeId] = DIAGRAM_COLORS.selectedBg;
  }
}

function appendChildWorkflowDiagram(input: {
  activeStepId?: string;
  childWorkflow: NonNullable<WorkflowRenderNode["childWorkflow"]>;
  context: DiagramBuildContext;
  lines: string[];
  nodeBgColors: Record<string, string>;
  nodeColors: Record<string, string>;
  parentNode: WorkflowRenderNode;
  patchPreview?: WorkflowDiagramPatchPreview;
}) {
  const parentNodeId = input.context.nodeIdByStepId[input.parentNode.id];
  const subgraphId = diagramNodeId(input.context, "sg", `${input.parentNode.id}:children`);
  input.lines.push(`  subgraph ${subgraphId} [${mermaidLabel(input.childWorkflow.label)}]`);
  input.lines.push("    direction TD");

  const emittedLoopIds = new Set<string>();
  const loopGroups = renderLoopGroups(input.childWorkflow.model);
  for (const child of input.childWorkflow.model.nodes) {
    const loop = loopGroups.find((group) => group.nodeIds.has(child.id));
    if (loop) {
      if (!emittedLoopIds.has(loop.loop.id)) {
        emittedLoopIds.add(loop.loop.id);
        appendRenderLoopGroup({
          ...input,
          childWorkflow: input.childWorkflow,
          loop,
        });
      }
      continue;
    }
    appendRenderNode({
      ...input,
      childIndex: modelStepIndex(input.childWorkflow.model, child.id),
      node: child,
      parentStepId: input.parentNode.id,
    });
  }

  for (const edge of modelEdges(input.childWorkflow.model)) {
    const from = input.context.nodeIdByStepId[childStepKey(input.parentNode.id, edge.source)];
    const to = input.context.nodeIdByStepId[childStepKey(input.parentNode.id, edge.target)];
    if (from && to) input.lines.push(`    ${edgeStatement(edge, from, to)}`);
  }

  for (const loop of input.childWorkflow.model.loops) {
    const start = input.context.nodeIdByStepId[childStepKey(input.parentNode.id, loop.start)];
    const end = input.context.nodeIdByStepId[childStepKey(input.parentNode.id, loop.backTo ?? loop.end)];
    if (start && end) input.lines.push(`    ${end} -.-> |repeat| ${start}`);
  }

  input.lines.push("  end");

  const firstChild = input.childWorkflow.model.nodes[0];
  const firstChildId = firstChild
    ? input.context.nodeIdByStepId[childStepKey(input.parentNode.id, firstChild.id)]
    : undefined;
  if (parentNodeId && firstChildId) input.lines.push(`  ${parentNodeId} -.-> ${firstChildId}`);
}

function appendRenderLoopGroup(input: {
  activeStepId?: string;
  childWorkflow: NonNullable<WorkflowRenderNode["childWorkflow"]>;
  context: DiagramBuildContext;
  lines: string[];
  loop: ReturnType<typeof renderLoopGroups>[number];
  nodeBgColors: Record<string, string>;
  nodeColors: Record<string, string>;
  parentNode: WorkflowRenderNode;
  patchPreview?: WorkflowDiagramPatchPreview;
}) {
  const loopId = diagramNodeId(input.context, "loop", `${input.parentNode.id}:${input.loop.loop.id}`);
  input.lines.push(`    subgraph ${loopId} [${mermaidLabel(input.loop.loop.label ?? "Loop")}]`);
  input.lines.push("      direction TD");
  for (const child of input.loop.nodes) {
    appendRenderNode({
      ...input,
      childIndex: modelStepIndex(input.childWorkflow.model, child.id),
      node: child,
      parentStepId: input.parentNode.id,
    });
  }
  input.lines.push("    end");
}

function modelStepIndex(model: WorkflowRenderModel, nodeId: string) {
  const steps = model.nodes.filter(
    (node) => node.kind !== "initial" && node.kind !== "trigger" && node.kind !== "end"
      && node.semantic.role !== "boundary" && node.semantic.role !== "trigger" && node.semantic.role !== "terminal",
  );
  const index = steps.findIndex((node) => node.id === nodeId);
  return index >= 0 ? index + 1 : undefined;
}

function renderLoopGroups(model: WorkflowRenderModel) {
  return model.loops.flatMap((loop) => {
    const startIndex = model.nodes.findIndex((node) => node.id === loop.start);
    const endIndex = model.nodes.findIndex((node) => node.id === loop.end);
    if (startIndex < 0 || endIndex < startIndex) return [];
    const nodes = model.nodes.slice(startIndex, endIndex + 1);
    return [{
      loop,
      nodeIds: new Set(nodes.map((node) => node.id)),
      nodes,
    }];
  });
}

function modelEdges(model: WorkflowRenderModel) {
  return model.edges;
}

function workflowTerminalNodeDetailsFromRenderModel(
  model: WorkflowRenderModel,
  activeStepId: string | undefined,
) {
  const details = new Map<string, {
    glyph?: string;
    label?: string;
    selected?: boolean;
    status?: string;
  }>();
  const visit = (current: WorkflowRenderModel, prefix = "", parentStepId: string | undefined = undefined) => {
    for (const node of current.nodes) {
      const layoutId = `${prefix}${node.id}`;
      const currentStepId = stepKey(parentStepId, node.id);
      const detail = {
        glyph: glyphForSemantic(node),
        label: renderNodeLabel(node),
        selected: activeStepId === currentStepId || activeStepId === node.id,
        status: node.status,
      };
      details.set(layoutId, detail);
      details.set(currentStepId, detail);
      if (node.childWorkflow) visit(node.childWorkflow.model, `${layoutId}:child:`, node.id);
    }
  };
  visit(model);
  return details;
}

function activeEdgeForNode(lines: string[], activeNode: string) {
  for (const line of lines) {
    const match = line.match(/^\s*(\S+)\s+[-.]+>\s+(?:\|[^|]+\|\s+)?(\S+)/);
    if (match?.[2] === activeNode) return { from: match[1]!, to: activeNode };
  }
  return undefined;
}

function renderNodeLabel(node: WorkflowRenderNode, index?: number) {
  const base = indexedNodeLabel(node, index);
  const detail = renderNodeDetail(node);
  return detail ? `${base}<br/>${detail}` : base;
}

function indexedNodeLabel(node: WorkflowRenderNode, index?: number) {
  if (node.semantic.role === "boundary") return "●";
  if (node.semantic.role === "trigger") return `[${node.semantic.triggerType}] ${node.label}`;
  if (node.semantic.role === "terminal") return `[${node.semantic.outcome}] ${node.label}`;
  if (!index || /^\d{2}\s/.test(node.label)) return node.label;
  return `${String(index).padStart(2, "0")} ${node.label}`;
}

function renderNodeDetail(node: WorkflowRenderNode) {
  const execution = node.childWorkflow?.execution;
  const semantic = workflowRenderSemanticLabel(node.semantic);
  const executionLabel = execution?.kind === "foreach"
    ? execution.label ?? "for each item"
    : execution?.kind === "loop" ? execution.label ?? "loop" : undefined;
  const status = node.status === "running" || node.status === "waiting" || node.status === "failed"
    ? node.status
    : undefined;
  return [semantic, executionLabel, status].filter(Boolean).join(" · ");
}

function renderNodeShape(node: WorkflowRenderNode): DiagramNodeShape {
  if (node.semantic.role === "boundary" || node.semantic.role === "trigger" || node.semantic.role === "terminal") return "rounded";
  if (node.semantic.role === "router") return "decision";
  if (node.semantic.role === "workflow" || node.semantic.role === "fork" || node.childWorkflow) return "subroutine";
  if (node.semantic.role === "interaction") return "decision";
  return "box";
}

function edgeStatement(edge: WorkflowRenderEdge, from: string, to: string) {
  const label = edge.semantic.role === "route"
    ? `${edge.semantic.route.selected ? "✓ " : ""}${edge.semantic.route.label}`
    : edge.semantic.role === "branch"
      ? edge.semantic.branch.label
      : edge.semantic.role === "join"
        ? `${edge.semantic.policy} join`
        : edge.semantic.role === "merge"
          ? "merge"
          : edge.label;
  return label ? `${from} --> |${mermaidLabel(label)}| ${to}` : `${from} --> ${to}`;
}

function nodeStatement(id: string, label: string, shape: DiagramNodeShape) {
  const safeLabel = mermaidLabel(label);
  if (shape === "database") return `${id}[(${safeLabel})]`;
  if (shape === "decision") return `${id}{${safeLabel}}`;
  if (shape === "rounded") return `${id}([${safeLabel}])`;
  if (shape === "subroutine") return `${id}[[${safeLabel}]]`;
  return `${id}[${safeLabel}]`;
}

function diagramNodeId(
  context: DiagramBuildContext,
  prefix: string,
  rawId: string,
  stepId?: string,
) {
  if (stepId && context.nodeIdByStepId[stepId]) return context.nodeIdByStepId[stepId];
  const base = `${prefix}_${sanitizeDiagramId(rawId)}`;
  let candidate = base;
  let suffix = 2;
  while (context.usedIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  context.usedIds.add(candidate);
  if (stepId) {
    context.nodeIdByStepId[stepId] = candidate;
    context.stepIdByNodeId[candidate] = stepId;
  }
  return candidate;
}

function sanitizeDiagramId(value: string) {
  const normalized = value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^([^A-Za-z_])/, "_$1");
  return normalized || "node";
}

function renderStatusColor(status: WorkflowRenderStatus | undefined) {
  if (status === "completed") return DIAGRAM_COLORS.done;
  if (status === "failed") return DIAGRAM_COLORS.failed;
  if (status === "running") return DIAGRAM_COLORS.running;
  if (status === "waiting") return DIAGRAM_COLORS.waiting;
  return DIAGRAM_COLORS.idle;
}

function addPatchColor(
  nodeColors: Record<string, string>,
  nodeId: string,
  stepId: string,
  patchPreview?: WorkflowDiagramPatchPreview,
) {
  if (patchPreview?.addedStepIds?.includes(stepId)) nodeColors[nodeId] = DIAGRAM_COLORS.added;
  if (patchPreview?.changedStepIds?.includes(stepId)) nodeColors[nodeId] = DIAGRAM_COLORS.changed;
  if (patchPreview?.removedStepIds?.includes(stepId)) nodeColors[nodeId] = DIAGRAM_COLORS.removed;
}

function glyphForSemantic(node: WorkflowRenderNode) {
  if (node.semantic.role === "boundary") return "●";
  if (node.semantic.role === "trigger") return "▶";
  if (node.semantic.role === "terminal") return node.semantic.outcome === "result" ? "■" : "!";
  if (node.semantic.role === "router") return "◇";
  if (node.semantic.role === "fork") return "⑂";
  if (node.semantic.role === "join") return "⋈";
  if (node.semantic.role === "merge") return "▽";
  if (node.semantic.role === "interaction") return "?";
  if (node.semantic.role === "model") return "✦";
  if (node.semantic.role === "evaluation") return "◉";
  if (node.semantic.role === "gate") return "◆";
  if (node.semantic.role === "workflow") return "◆";
  if (node.semantic.role === "group") return "◇";
  return "□";
}

function stepKey(parentStepId: string | undefined, nodeId: string) {
  return parentStepId ? childStepKey(parentStepId, nodeId) : nodeId;
}
