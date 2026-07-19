import type {
  LoopGraphChildNode,
  LoopGraphNode,
} from "../../core/index.js";
import { toWorkflowRoomJsonObject } from "../workflow-room/json.js";
import { stepPorts } from "./projection-helpers.js";
import {
  childNodeSemantic,
  graphNodeSemantic,
} from "./projection-semantics.js";
import type {
  WorkflowRenderChildWorkflow,
  WorkflowRenderNode,
  WorkflowRenderStatus,
} from "./types.js";
import type { WorkflowRenderNodeSemantic } from "@dromio/workflow-canvas-protocol";

export function projectGraphChildWorkflow(
  node: LoopGraphNode,
  childWorkflowId: string,
  statuses?: Record<string, WorkflowRenderStatus | undefined>,
  selectedRouteId?: string,
): WorkflowRenderChildWorkflow {
  const children = node.childNodes ?? [];
  const triggerId = childBoundaryId(`${childWorkflowId}:trigger`, children);
  const endId = childBoundaryId(`${childWorkflowId}:end`, children, triggerId);
  const initialId = childBoundaryId(`${childWorkflowId}:initial`, children, triggerId);
  const childNodes = children.map((child): WorkflowRenderNode => ({
    ...(child.catalogItemId ? { catalogItemId: child.catalogItemId } : {}),
    ...(child.description ? { description: child.description } : {}),
    id: child.id,
    kind: child.catalog?.execution?.childWorkflowDocumentId || child.catalog?.kind === "workflow" ? "workflow" : "step",
    label: child.label,
    metadata: toWorkflowRoomJsonObject({
      ...(child.branch ? { branch: child.branch } : {}),
      ...(child.route ? { route: child.route } : {}),
      ...(child.catalog ? { catalog: child.catalog } : {}),
      ...(child.loop ? { loop: child.loop } : {}),
    }),
    ports: stepPorts(child.input, child.output, child.id),
    semantic: childNodeSemantic(child, statuses?.[child.id]),
    ...(statuses?.[child.id] ? { status: statuses[child.id] } : {}),
  }));
  const label = `${node.label} child workflow`;
  return {
    ...(node.catalog?.execution ? { execution: node.catalog.execution } : {}),
    id: childWorkflowId,
    label,
    model: {
      ...(node.description ? { description: node.description } : {}),
      edges: [
        {
          id: `${initialId}->${triggerId}`,
          metadata: toWorkflowRoomJsonObject({ kind: "sequence" }),
          semantic: { role: "sequence" },
          source: initialId,
          target: triggerId,
        },
        ...childWorkflowEdges(children, triggerId, endId, node.catalog?.execution?.joinPolicy, selectedRouteId),
      ],
      id: childWorkflowId,
      label,
      loops: graphChildWorkflowLoops(node),
      nodes: [
        childInitialNode(initialId),
        childBoundaryNode(triggerId, "trigger", childBoundarySemantic(node, "trigger", selectedRouteId)),
        ...childNodes,
        childBoundaryNode(endId, "end", childBoundarySemantic(node, "end", selectedRouteId)),
      ],
      readOnly: true,
      warnings: childNodes.length ? [] : ["Child workflow has no renderable nodes."],
    },
  };
}

function childInitialNode(id: string): WorkflowRenderNode {
  return {
    id,
    kind: "initial",
    label: "Initial state",
    metadata: {},
    ports: [{ id: `${id}:out`, type: "source" }],
    semantic: { boundary: "initial", role: "boundary" },
  };
}

function childBoundaryId(
  preferred: string,
  nodes: readonly LoopGraphChildNode[],
  reserved?: string,
) {
  const usedIds = new Set([...nodes.map((node) => node.id), reserved]);
  if (!usedIds.has(preferred)) return preferred;
  let index = 1;
  while (usedIds.has(`${preferred}-${index}`)) index += 1;
  return `${preferred}-${index}`;
}

function childBoundaryNode(
  id: string,
  kind: "end" | "trigger",
  semantic: WorkflowRenderNodeSemantic,
): WorkflowRenderNode {
  return {
    id,
    kind,
    label: childBoundaryLabel(kind, semantic),
    metadata: {},
    ports: [{
      id: `${id}:${kind === "trigger" ? "out" : "in"}`,
      type: kind === "trigger" ? "source" : "target",
    }],
    semantic,
  };
}

function childBoundaryLabel(
  kind: "end" | "trigger",
  semantic: WorkflowRenderNodeSemantic,
) {
  if (kind === "trigger") return "Trigger";
  if (semantic.role === "merge") return "Merge selected route";
  if (semantic.role === "join") {
    return semantic.policy === "all" ? "Join all branches" : "Join any branch";
  }
  return "End";
}

function childWorkflowEdges(
  nodes: LoopGraphChildNode[],
  triggerId: string,
  endId: string,
  joinPolicy: "all" | "any" | undefined,
  selectedRouteId: string | undefined,
) {
  const branches = new Map<string, LoopGraphChildNode[]>();
  for (const node of nodes) {
    const branchId = node.route?.id ?? node.branch?.id ?? "default";
    branches.set(branchId, [...(branches.get(branchId) ?? []), node]);
  }
  if (branches.size === 0) {
    return [{
      id: `${triggerId}->${endId}`,
      metadata: toWorkflowRoomJsonObject({ kind: "sequence" }),
      semantic: { role: "sequence" as const },
      source: triggerId,
      target: endId,
    }];
  }
  const routed = nodes.some((node) => Boolean(node.route));
  const forked = !routed && branches.size > 1;
  return [...branches.entries()].flatMap(([branchId, branchNodes]) => {
    const first = branchNodes[0]!;
    const last = branchNodes.at(-1)!;
    return [
      childBoundaryEdge(
        triggerId,
        first,
        branchId,
        routed ? "route" : forked ? "fork" : "sequence",
        joinPolicy,
        selectedRouteId,
      ),
      ...branchNodes.slice(0, -1).map((child, index) => {
        const target = branchNodes[index + 1]!;
        return {
          id: `${branchId}:${child.id}->${target.id}`,
          metadata: toWorkflowRoomJsonObject({
            ...(child.branch ? { branch: child.branch } : {}),
            ...(child.route ? { route: child.route } : {}),
            kind: "sequence",
          }),
          semantic: { role: "sequence" as const },
          source: child.id,
          target: target.id,
        };
      }),
      childBoundaryEdge(
        last.id,
        { ...last, id: endId },
        branchId,
        routed ? "merge" : forked ? "join" : "sequence",
        joinPolicy,
        selectedRouteId,
      ),
    ];
  });
}

function childBoundaryEdge(
  source: string,
  target: LoopGraphChildNode,
  branchId: string,
  kind: "fork" | "join" | "merge" | "route" | "sequence",
  joinPolicy: "all" | "any" | undefined,
  selectedRouteId: string | undefined,
) {
  const branch = target.route ?? target.branch ?? { id: branchId };
  const label = branch.label ?? branch.id;
  return {
    id: `${branchId}:${source}->${target.id}`,
    ...(kind === "route" || kind === "fork" ? { label } : {}),
    metadata: toWorkflowRoomJsonObject({
      ...(target.branch ? { branch: target.branch } : {}),
      ...(target.route ? { route: target.route } : {}),
      kind,
    }),
    semantic: kind === "route"
      ? { role: "route" as const, route: { id: branch.id, label, selected: branch.id === selectedRouteId } }
      : kind === "fork"
        ? { branch: { id: branch.id, label }, role: "branch" as const }
        : kind === "join"
          ? { policy: joinPolicy ?? "all", role: "join" as const }
          : kind === "merge"
            ? { mode: "exclusive" as const, role: "merge" as const }
            : { role: "sequence" as const },
    source,
    target: target.id,
  };
}

function childBoundarySemantic(
  node: LoopGraphNode,
  kind: "end" | "trigger",
  selectedRouteId: string | undefined,
): WorkflowRenderNodeSemantic {
  if (kind === "trigger") return graphNodeSemantic({ node, ...(selectedRouteId ? { selectedRouteId } : {}) });
  if (node.catalog?.execution?.kind === "router") return { mode: "exclusive", role: "merge" };
  if (node.catalog?.execution?.kind === "fork") {
    return { policy: node.catalog.execution.joinPolicy ?? "all", role: "join" };
  }
  return { outcome: "result", role: "terminal" };
}

function graphChildWorkflowLoops(node: LoopGraphNode) {
  const loops = new Map<string, {
    backTo?: string;
    end: string;
    id: string;
    label?: string;
    start: string;
  }>();
  for (const child of node.childNodes ?? []) {
    if (!child.loop) continue;
    loops.set(child.loop.id, {
      ...(child.loop.backToNodeId ? { backTo: child.loop.backToNodeId } : {}),
      end: child.loop.endNodeId,
      id: child.loop.id,
      ...(child.loop.label ? { label: child.loop.label } : {}),
      start: child.loop.startNodeId,
    });
  }
  return [...loops.values()];
}
