import type {
  WorkflowRenderModel,
  WorkflowRenderNode,
  WorkflowRenderStatus,
} from "./types.js";

export type WorkflowOutlineChildrenMode = "parallel" | "routes" | "sequence";

export type WorkflowOutlineNodeDetail = {
  label?: string;
  selected?: boolean;
  status?: WorkflowRenderStatus;
};

export type WorkflowOutlineItem = {
  children: WorkflowOutlineItem[];
  childrenMode?: WorkflowOutlineChildrenMode;
  description?: string;
  id: string;
  key: string;
  kind: WorkflowRenderNode["kind"];
  label: string;
  selected: boolean;
  status?: WorkflowRenderStatus;
};

export type WorkflowOutlineProjection = {
  id: string;
  items: WorkflowOutlineItem[];
  label: string;
};

export function projectWorkflowOutline(input: {
  includeBoundaries?: boolean;
  model: WorkflowRenderModel;
  nodeDetails?: ReadonlyMap<string, WorkflowOutlineNodeDetail>;
  statuses?: Readonly<Record<string, WorkflowRenderStatus | undefined>>;
}): WorkflowOutlineProjection {
  return {
    id: input.model.id,
    items: projectItems(input.model, [], input),
    label: input.model.label,
  };
}

function projectItems(
  model: WorkflowRenderModel,
  ancestors: string[],
  input: Parameters<typeof projectWorkflowOutline>[0],
): WorkflowOutlineItem[] {
  return model.nodes
    .filter((node) => input.includeBoundaries || !isBoundary(node))
    .map((node) => projectItem(node, ancestors, input));
}

function projectItem(
  node: WorkflowRenderNode,
  ancestors: string[],
  input: Parameters<typeof projectWorkflowOutline>[0],
): WorkflowOutlineItem {
  const key = [...ancestors, node.id].join("::");
  const detail = input.nodeDetails?.get(key) ?? input.nodeDetails?.get(node.id);
  const childModel = node.childWorkflow?.model;
  const children = childModel ? projectItems(childModel, [...ancestors, node.id], input) : [];
  return {
    children,
    ...(children.length ? { childrenMode: childMode(node) } : {}),
    ...(node.description ? { description: node.description } : {}),
    id: node.id,
    key,
    kind: node.kind,
    label: detail?.label ?? node.label,
    selected: detail?.selected ?? node.id === input.model.selectedNodeId,
    status: detail?.status ?? input.statuses?.[key] ?? input.statuses?.[node.id] ?? node.status,
  };
}

function childMode(node: WorkflowRenderNode): WorkflowOutlineChildrenMode {
  if (node.semantic.role === "fork") return "parallel";
  if (node.semantic.role === "router") return "routes";
  return "sequence";
}

function isBoundary(node: WorkflowRenderNode) {
  return node.kind === "initial" || node.kind === "trigger" || node.kind === "end" ||
    node.semantic.role === "boundary" || node.semantic.role === "trigger" ||
    node.semantic.role === "terminal" || node.semantic.role === "join" || node.semantic.role === "merge";
}
