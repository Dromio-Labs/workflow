import { type WorkflowApp, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { displayText, formatStepIndex, isWorkflowLoopStep, workflowStepDisplayLabel } from "./artifact-step-pages.js";
import { truncate } from "./string-format.js";
import { type ShellRoute, type TuiArtifact } from "./types.js";
import { type StepPromptView } from "./workflow-file-helpers.js";

export function workflowDescriptor(
  workflows: WorkflowAppWorkflowDescriptor[],
  workflowId: string,
) {
  return workflows.find((workflow) => workflow.id === workflowId) ?? workflows[0]!;
}

export type WorkflowDesignNode = {
  boundary?: "end" | "trigger";
  catalog?: WorkflowRunStoreSnapshot["steps"][number]["catalog"];
  catalogItemId?: string;
  childNodes?: WorkflowDesignChildNode[];
  description?: string;
  id: string;
  index: number;
  indexLabel?: string;
  label: string;
  models?: Array<{
    label?: string;
    operation: string;
    prompt?: StepPromptView;
  }>;
  nested?: boolean;
  parentStepId?: string;
  triggerType?: string;
};

export type WorkflowDesignChildNode = NonNullable<ReturnType<WorkflowApp["graph"]>["nodes"][number]["childNodes"]>[number];

export type StartStepOutlineItem = {
  depth: number;
  expandable: boolean;
  expanded: boolean;
  id: string;
  indexLabel: string;
  node: WorkflowDesignNode;
  parentId?: string;
};

export function workflowDesignNodes(graph: ReturnType<WorkflowApp["graph"]>): WorkflowDesignNode[] {
  const triggerNode = graph.trigger
    ? {
      boundary: "trigger" as const,
      description: graph.trigger.description,
      id: graph.trigger.id,
      index: 0,
      label: graph.trigger.label,
      triggerType: graph.trigger.type,
    }
    : {
      boundary: "trigger" as const,
      description: "Input received and workflow run created.",
      id: "$trigger",
      index: 0,
      label: "Trigger",
    };
  const endNode = graph.end
    ? {
      boundary: "end" as const,
      description: graph.end.description,
      id: graph.end.id,
      index: graph.nodes.length + 1,
      label: graph.end.label,
    }
    : {
      boundary: "end" as const,
      description: "Workflow terminal state.",
      id: "$end",
      index: graph.nodes.length + 1,
      label: "End",
    };
  return [
    triggerNode,
    ...graph.nodes.map((node, index) => ({
      catalog: node.catalog,
      catalogItemId: node.catalogItemId,
      childNodes: node.childNodes,
      description: node.description,
      id: node.id,
      index: index + 1,
      label: node.label,
      models: node.models,
    })),
    endNode,
  ];
}

export function workflowStartOutlineItems(
  graph: ReturnType<WorkflowApp["graph"]>,
  expandedStepIds: ReadonlySet<string>,
): StartStepOutlineItem[] {
  const items: StartStepOutlineItem[] = [];
  for (const node of workflowDesignNodes(graph)) {
    const childNodes = node.childNodes ?? [];
    const expandable = childNodes.length > 0 || isWorkflowLoopStep(node);
    const expanded = expandable && expandedStepIds.has(node.id);
    items.push({
      depth: 0,
      expandable,
      expanded,
      id: node.id,
      indexLabel: formatStepIndex(node),
      node,
    });
    if (!expanded) continue;
    for (const [index, child] of childNodes.entries()) {
      const childIndex = index + 1;
      const childId = workflowDesignChildStepId(node.id, child.id);
      items.push({
        depth: 1,
        expandable: false,
        expanded: false,
        id: childId,
        indexLabel: `${formatStepIndex(node)}.${String(childIndex).padStart(2, "0")}`,
        node: workflowDesignChildNode(node, child, childId, childIndex),
        parentId: node.id,
      });
    }
  }
  return items;
}

export function workflowDiagramSelectableStepIds(graph: ReturnType<WorkflowApp["graph"]>): string[] {
  const ids: string[] = [];
  for (const node of workflowDesignNodes(graph)) {
    ids.push(node.id);
    for (const child of node.childNodes ?? []) {
      ids.push(workflowDesignChildStepId(node.id, child.id));
    }
  }
  return ids;
}

export function workflowDesignChildNode(
  parent: WorkflowDesignNode,
  child: WorkflowDesignChildNode,
  id: string,
  index: number,
): WorkflowDesignNode {
  return {
    catalog: child.catalog,
    catalogItemId: child.catalogItemId,
    description: child.description,
    id,
    index,
    indexLabel: `${formatStepIndex(parent)}.${String(index).padStart(2, "0")}`,
    label: child.label,
    nested: true,
    parentStepId: parent.id,
  };
}

export function workflowDesignChildStepId(parentStepId: string, childStepId: string) {
  return `${parentStepId}::${childStepId}`;
}

export function parentStepIdFromChildStepId(stepId: string) {
  const separatorIndex = stepId.indexOf("::");
  return separatorIndex >= 0 ? stepId.slice(0, separatorIndex) : undefined;
}

export function startOutlineLine(item: StartStepOutlineItem, selected: boolean) {
  const marker = selected ? "> " : "  ";
  const indent = "  ".repeat(item.depth);
  const tree = item.expandable ? item.expanded ? "▾ " : "▸ " : item.depth > 0 ? "└ " : "  ";
  const width = Math.max(10, 31 - marker.length - indent.length - tree.length - item.indexLabel.length);
  return `${marker}${indent}${tree}${item.indexLabel} ${truncate(displayText(workflowStepDisplayLabel(item.node)), width)}`;
}

export function workflowDesignNodeIndexLabel(node: WorkflowDesignNode) {
  return node.indexLabel ?? formatStepIndex(node);
}

export function firstDesignNodeId(app: WorkflowApp, workflowId: string) {
  return workflowDesignNodes(app.graph(workflowId))[0]?.id;
}

export function routeTitle(route: ShellRoute) {
  if (route.type === "library") return "Workflow Library";
  if (route.type === "start") return "Start Workflow";
  if (route.type === "triggers") return "Trigger Registry";
  if (route.type === "triggerFire") return "Fire Trigger";
  if (route.type === "triggerJobs") return "Trigger Jobs";
  if (route.type === "artifact") return "Result Artifact";
  if (route.type === "step") return "Step Detail";
  return "Workflow Run";
}

export function routeBreadcrumb(route: ShellRoute, workflow: WorkflowAppWorkflowDescriptor) {
  const root = "Workflow Library";
  if (route.type === "library") return root;
  const parts = [root, workflow.title, routeTitle(route)];
  if (route.type === "step") parts.push(route.stepId);
  if (route.type === "artifact" && route.artifactName) parts.push(route.artifactName);
  if (route.type === "triggerFire") parts.push(route.triggerId);
  if (route.type === "triggerJobs" && route.jobId) parts.push(route.jobId);
  if (route.type === "triggers" && route.triggerId) parts.push(route.triggerId);
  return parts.join(" / ");
}

export function slashCommandInputForRun(query: string, fallback: string) {
  const trimmed = query.trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function artifactWorkflowId(route: ShellRoute, fallbackWorkflowId: string) {
  return route.type === "artifact" ? route.workflowId : fallbackWorkflowId;
}

export function isSelectedArtifact(route: ShellRoute, artifact: TuiArtifact) {
  if (route.type !== "artifact") return false;
  if (route.artifactName) return route.artifactName === artifact.name;
  return artifact.kind === "result";
}
