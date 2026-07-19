import type {
  LoopGraphBoundary,
  LoopGraphNode,
} from "../../core/index.js";
import { toWorkflowRoomJsonObject } from "../workflow-room/json.js";
import { projectGraphChildWorkflow } from "./graph-child-workflow.js";
import { boundaryPorts, stepPorts } from "./projection-helpers.js";
import {
  documentNodeSemantic,
  graphNodeSemantic,
  terminalSemantic,
  triggerSemantic,
  workflowRenderTriggerType,
} from "./projection-semantics.js";
import type {
  WorkflowRenderCatalogLookup,
  WorkflowRenderBoundaryLike,
  WorkflowRenderChildWorkflow,
  WorkflowRenderChildWorkflowLike,
  WorkflowRenderDocumentLike,
  WorkflowRenderDocumentNodeLike,
  WorkflowRenderInteraction,
  WorkflowRenderModel,
  WorkflowRenderNode,
  WorkflowRenderNodeKind,
  WorkflowRenderPort,
  WorkflowRenderProjectionInput,
  WorkflowRenderStatus,
} from "./types.js";

const MAX_CHILD_WORKFLOW_DEPTH = 4;

type WorkflowDocumentProjectionInput = {
  catalog?: WorkflowRenderCatalogLookup;
  childWorkflows?: Record<string, WorkflowRenderChildWorkflowLike>;
  document: WorkflowRenderDocumentLike;
  readOnly?: boolean;
  selectedNodeId?: string;
  statuses?: Record<string, WorkflowRenderStatus | undefined>;
};

export function projectWorkflowGraphRenderModel(
  input: WorkflowRenderProjectionInput,
): WorkflowRenderModel {
  const renderGraph = graphWithRenderableBoundaries(input.graph);
  const initialId = syntheticGraphInitialId(renderGraph);
  const triggerNodes = renderEntryTriggerNodes(renderGraph.trigger, input.entryTriggers, input.statuses);
  const graphNodes = [
    initialNode(initialId),
    ...triggerNodes,
    ...renderGraph.nodes.map((node) => graphStepNode(
      node,
      input.statuses,
      input.interactions?.find((interaction) => interaction.stepId === node.id),
      input.selectedRoutes?.[node.id],
    )),
    boundaryNode(renderGraph.end, "end", input.statuses, input.terminalOutcome),
  ];
  return {
    ...(renderGraph.description ? { description: renderGraph.description } : {}),
    edges: [...triggerNodes.map((trigger) => ({
      id: `${initialId}->${trigger.id}`,
      metadata: toWorkflowRoomJsonObject({ kind: "sequence" }),
      semantic: { role: "sequence" as const },
      source: initialId,
      target: trigger.id,
    })), ...renderGraph.edges.flatMap((edge) => triggerNodesForEdge(edge.from, renderGraph.trigger.id, triggerNodes).map((source) => ({
      id: source === edge.from ? edge.id : `${source}:${edge.id}`,
      metadata: toWorkflowRoomJsonObject({ kind: edge.kind }),
      semantic: { role: "sequence" as const },
      source,
      target: edge.to,
    })))],
    id: renderGraph.id,
    label: stringOrFallback(renderGraph.label, titleFromIdentifier(renderGraph.id)),
    loops: [],
    nodes: graphNodes,
    readOnly: input.readOnly ?? true,
    ...(input.selectedNodeId ? { selectedNodeId: input.selectedNodeId } : {}),
    warnings: [],
  };
}

function renderEntryTriggerNodes(
  boundary: LoopGraphBoundary,
  triggers: WorkflowRenderProjectionInput["entryTriggers"],
  statuses?: Record<string, WorkflowRenderStatus | undefined>,
) {
  if (!triggers?.length) return [boundaryNode(boundary, "trigger", statuses)];
  return triggers.map((trigger): WorkflowRenderNode => ({
    ...(trigger.description ? { description: trigger.description } : {}),
    id: trigger.id,
    kind: "trigger",
    label: trigger.label,
    metadata: toWorkflowRoomJsonObject({
      ...(trigger.config ? { config: trigger.config } : {}),
      ...(trigger.input ? { input: trigger.input } : {}),
      type: trigger.type,
    }),
    ports: boundaryPorts({ ...boundary, id: trigger.id, label: trigger.label }, "trigger"),
    semantic: triggerSemantic(trigger.type, trigger.input.kind),
    ...(statuses?.[trigger.id] ? { status: statuses[trigger.id] } : {}),
  }));
}

function triggerNodesForEdge(source: string, boundaryId: string, triggers: WorkflowRenderNode[]) {
  return source === boundaryId ? triggers.map((trigger) => trigger.id) : [source];
}

function graphWithRenderableBoundaries(graph: WorkflowRenderProjectionInput["graph"]) {
  const trigger = graph.trigger ?? {
    boundary: "trigger" as const,
    id: syntheticGraphBoundaryId("$trigger", graph),
    label: "Trigger",
    type: "manual",
  };
  const end = graph.end ?? {
    boundary: "end" as const,
    id: syntheticGraphBoundaryId("$end", graph),
    label: "End",
  };
  return {
    ...graph,
    edges: graphEdgesWithRenderableBoundaries(graph, trigger.id, end.id),
    end,
    trigger,
  };
}

function graphEdgesWithRenderableBoundaries(
  graph: WorkflowRenderProjectionInput["graph"],
  triggerId: string,
  endId: string,
) {
  const edges = [...graph.edges];
  if (!graph.trigger) {
    const firstTarget = graph.nodes[0]?.id ?? endId;
    if (!edges.some((edge) => edge.from === triggerId)) {
      edges.unshift({
        from: triggerId,
        id: `${triggerId}->${firstTarget}`,
        kind: "sequence",
        to: firstTarget,
      });
    }
  }
  if (!graph.end) {
    const lastSource = graph.nodes.at(-1)?.id ?? triggerId;
    if (!edges.some((edge) => edge.to === endId)) {
      edges.push({
        from: lastSource,
        id: `${lastSource}->${endId}`,
        kind: "sequence",
        to: endId,
      });
    }
  }
  return edges;
}

function syntheticGraphBoundaryId(preferred: "$end" | "$trigger", graph: WorkflowRenderProjectionInput["graph"]) {
  const usedIds = new Set([
    graph.end?.id,
    graph.trigger?.id,
    ...graph.nodes.map((node) => node.id),
  ].filter((id): id is string => typeof id === "string"));
  if (!usedIds.has(preferred)) return preferred;
  let index = 1;
  while (usedIds.has(`${preferred}-${index}`)) index += 1;
  return `${preferred}-${index}`;
}

function syntheticGraphInitialId(graph: ReturnType<typeof graphWithRenderableBoundaries>) {
  const usedIds = new Set([graph.trigger.id, graph.end.id, ...graph.nodes.map((node) => node.id)]);
  if (!usedIds.has("$initial")) return "$initial";
  let index = 1;
  while (usedIds.has(`$initial-${index}`)) index += 1;
  return `$initial-${index}`;
}

function initialNode(id: string): WorkflowRenderNode {
  return {
    id,
    kind: "initial",
    label: "Initial state",
    metadata: {},
    ports: [{ id: `${id}:out`, label: "start", type: "source" }],
    semantic: { boundary: "initial", role: "boundary" },
  };
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function titleFromIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function projectWorkflowDocumentRenderModel(input: WorkflowDocumentProjectionInput): WorkflowRenderModel {
  return projectWorkflowDocumentRenderModelAtDepth(input, 0);
}

function projectWorkflowDocumentRenderModelAtDepth(
  input: WorkflowDocumentProjectionInput,
  depth: number,
): WorkflowRenderModel {
  const document = input.document;
  const workflowId = document.id ?? "workflow";
  const triggerId = document.trigger?.id ?? `${workflowId}:trigger`;
  const endId = document.end?.id ?? `${workflowId}:end`;
  const nodes = document.nodes ?? [];
  const initialId = uniqueDocumentInitialId(workflowId, triggerId, endId, nodes);
  const renderNodes = [
    initialNode(initialId),
    documentBoundaryNode("trigger", triggerId, document.trigger, input.statuses),
    ...nodes.map((node, index) =>
      documentStepNode(
        node,
        index + 1,
        input.catalog,
        input.childWorkflows,
        input.statuses,
        depth,
      )
    ),
    documentBoundaryNode("end", endId, document.end, input.statuses),
  ];
  return {
    ...(document.description ? { description: document.description } : {}),
    edges: [{
      id: `${initialId}->${triggerId}`,
      metadata: toWorkflowRoomJsonObject({ kind: "sequence" }),
      semantic: { role: "sequence" as const },
      source: initialId,
      target: triggerId,
    }, ...(document.edges ?? []).map((edge, index) => ({
      id: edge.id ?? `${edge.source ?? "missing"}->${edge.target ?? "missing"}-${index}`,
      ...(edge.label ? { label: edge.label } : {}),
      metadata: toWorkflowRoomJsonObject(edge.metadata),
      semantic: { role: "sequence" as const },
      source: endpointId(edge.source, document.trigger?.id, document.end?.id, triggerId, endId),
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      target: endpointId(edge.target, document.trigger?.id, document.end?.id, triggerId, endId),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    }))],
    id: workflowId,
    label: document.label ?? workflowId,
    loops: workflowLoops(document),
    nodes: renderNodes,
    readOnly: input.readOnly ?? true,
    ...(input.selectedNodeId ? { selectedNodeId: input.selectedNodeId } : {}),
    warnings: [],
  };
}

function uniqueDocumentInitialId(
  workflowId: string,
  triggerId: string,
  endId: string,
  nodes: WorkflowRenderDocumentNodeLike[],
) {
  const preferred = `${workflowId}:initial`;
  const usedIds = new Set([triggerId, endId, ...nodes.map((node) => node.id)]);
  if (!usedIds.has(preferred)) return preferred;
  let index = 1;
  while (usedIds.has(`${preferred}-${index}`)) index += 1;
  return `${preferred}-${index}`;
}

function boundaryNode(
  boundary: LoopGraphBoundary,
  kind: "end" | "trigger",
  statuses?: Record<string, WorkflowRenderStatus | undefined>,
  terminalOutcome?: WorkflowRenderProjectionInput["terminalOutcome"],
): WorkflowRenderNode {
  return {
    ...(boundary.description ? { description: boundary.description } : {}),
    id: boundary.id,
    kind,
    label: boundary.label,
    metadata: toWorkflowRoomJsonObject({
      ...(boundary.config ? { config: boundary.config } : {}),
      ...(boundary.type ? { type: boundary.type } : {}),
    }),
    ports: boundaryPorts(boundary, kind),
    semantic: kind === "trigger"
      ? triggerSemantic(workflowRenderTriggerType(boundary.type))
      : terminalSemantic(terminalOutcome),
    ...(statuses?.[boundary.id] ? { status: statuses[boundary.id] } : {}),
  };
}

function graphStepNode(
  node: LoopGraphNode,
  statuses?: Record<string, WorkflowRenderStatus | undefined>,
  interaction?: WorkflowRenderInteraction,
  selectedRouteId?: string,
): WorkflowRenderNode {
  const childWorkflowId = node.catalog?.execution?.childWorkflowDocumentId
    ?? (node.catalog?.execution?.branches?.length ? `${node.id}.fork` : undefined)
    ?? (node.catalog?.execution?.routes?.length ? `${node.id}.router` : undefined);
  const childWorkflow =
    childWorkflowId && node.childNodes?.length
      ? projectGraphChildWorkflow(node, childWorkflowId, statuses, selectedRouteId)
      : undefined;
  return {
    ...(node.catalogItemId ? { catalogItemId: node.catalogItemId } : {}),
    ...(childWorkflow ? { childWorkflow } : {}),
    ...(childWorkflowId ? { childWorkflowId } : {}),
    ...(node.description ? { description: node.description } : {}),
    id: node.id,
    kind: graphNodeKind(node),
    label: node.label,
    metadata: toWorkflowRoomJsonObject({
      ...(node.catalog ? { catalog: node.catalog } : {}),
      ...(node.models ? { models: node.models } : {}),
    }),
    ports: stepPorts(node.input, node.output, node.id),
    semantic: graphNodeSemantic({
      ...(interaction ? { interaction } : {}),
      node,
      ...(selectedRouteId ? { selectedRouteId } : {}),
      ...(statuses?.[node.id] ? { status: statuses[node.id] } : {}),
    }),
    ...(statuses?.[node.id] ? { status: statuses[node.id] } : {}),
  };
}

function documentBoundaryNode(
  kind: "end" | "trigger",
  id: string,
  boundary: WorkflowRenderBoundaryLike | undefined,
  statuses: Record<string, WorkflowRenderStatus | undefined> | undefined,
): WorkflowRenderNode {
  return {
    ...(boundary?.description ? { description: boundary.description } : {}),
    id,
    kind,
    label: boundary?.label ?? (kind === "trigger" ? "Start" : "Done"),
    metadata: toWorkflowRoomJsonObject({
      ...(boundary?.input ? { input: boundary.input } : {}),
      ...(boundary?.metadata ? { metadata: boundary.metadata } : {}),
      ...(boundary?.output ? { output: boundary.output } : {}),
      ...(boundary?.type ? { type: boundary.type } : {}),
    }),
    ports: kind === "trigger"
      ? [{ id: `${id}:out`, label: "next", type: "source" }]
      : [{ id: `${id}:in`, label: "input", type: "target" }],
    semantic: kind === "trigger"
      ? triggerSemantic(workflowRenderTriggerType(boundary?.type))
      : terminalSemantic(),
    ...(statuses?.[id] ? { status: statuses[id] } : {}),
  };
}

function documentStepNode(
  node: WorkflowRenderDocumentNodeLike,
  index: number,
  catalog: WorkflowRenderCatalogLookup | undefined,
  childWorkflows: Record<string, WorkflowRenderChildWorkflowLike> | undefined,
  statuses: Record<string, WorkflowRenderStatus | undefined> | undefined,
  depth: number,
): WorkflowRenderNode {
  const id = node.id ?? `node-${index}`;
  const catalogItem = node.catalogItemId ? catalog?.get(node.catalogItemId) : undefined;
  const childWorkflowId = node.childWorkflowId ?? node.workflowId ?? catalogItem?.execution?.childWorkflowDocumentId;
  const childWorkflow = childWorkflowForNode({
    catalogItem,
    childWorkflowId,
    childWorkflows,
    depth,
  });
  return {
    ...(node.catalogItemId ? { catalogItemId: node.catalogItemId } : {}),
    ...(childWorkflow ? { childWorkflow } : {}),
    ...(childWorkflowId ? { childWorkflowId } : {}),
    ...(node.description ?? catalogItem?.description
      ? { description: node.description ?? catalogItem?.description }
      : {}),
    id,
    kind: documentNodeKind(node, catalogItem?.kind),
    label: node.label ?? catalogItem?.label ?? id,
    metadata: toWorkflowRoomJsonObject({
      ...(node.config ? { config: node.config } : {}),
      ...(catalogItem ? { catalog: catalogItem } : {}),
      ...(node.input ?? node.inputs ? { input: node.input ?? node.inputs } : {}),
      ...(node.metadata ? { metadata: node.metadata } : {}),
      ...(node.output ?? node.outputs ? { output: node.output ?? node.outputs } : {}),
      ...(node.type ? { type: node.type } : {}),
    }),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ports: [{ id: `${id}:in`, type: "target" }, { id: `${id}:out`, type: "source" }],
    semantic: documentNodeSemantic({
      ...(catalogItem?.execution?.branches ? { branches: catalogItem.execution.branches } : {}),
      ...(catalogItem?.kind ? { catalogKind: catalogItem.kind } : {}),
      ...(catalogItem?.execution?.kind ? { executionKind: catalogItem.execution.kind } : {}),
      hasChildWorkflow: Boolean(childWorkflowId),
      node,
      ...(catalogItem?.execution?.routes ? { routes: catalogItem.execution.routes } : {}),
      ...(statuses?.[id] ? { status: statuses[id] } : {}),
    }),
    ...(statuses?.[id] ? { status: statuses[id] } : {}),
  };
}

function childWorkflowForNode(input: {
  catalogItem: ReturnType<WorkflowRenderCatalogLookup["get"]> | undefined;
  childWorkflowId: string | undefined;
  childWorkflows: Record<string, WorkflowRenderChildWorkflowLike> | undefined;
  depth: number;
}): WorkflowRenderChildWorkflow | undefined {
  if (!input.childWorkflowId || input.depth >= MAX_CHILD_WORKFLOW_DEPTH) return;
  const child = input.childWorkflows?.[input.childWorkflowId];
  if (!child) return;
  const model = projectWorkflowDocumentRenderModelAtDepth({
    catalog: child.catalog,
    childWorkflows: child.childWorkflows,
    document: child.document,
    readOnly: true,
    selectedNodeId: child.selectedNodeId,
  }, input.depth + 1);
  return {
    ...(model.description ? { description: model.description } : {}),
    ...(input.catalogItem?.execution ? { execution: input.catalogItem.execution } : {}),
    id: input.childWorkflowId,
    label: model.label,
    model,
  };
}

function graphNodeKind(node: LoopGraphNode): WorkflowRenderNodeKind {
  if (node.kind === "group") return "group";
  if (node.catalog?.kind === "workflow" || node.catalog?.execution?.childWorkflowDocumentId || node.childNodes?.length) {
    return "workflow";
  }
  return "step";
}

function documentNodeKind(node: WorkflowRenderDocumentNodeLike, catalogKind?: string): WorkflowRenderNodeKind {
  if (node.type === "group" || node.kind === "group" || node.config?.type === "group" || catalogKind === "group") {
    return "group";
  }
  if (node.childWorkflowId || node.workflowId || catalogKind === "workflow") return "workflow";
  return "step";
}

function workflowLoops(document: WorkflowRenderDocumentLike) {
  return (document.loops ?? []).flatMap((loop, index) => {
    const id = loop.id ?? `loop-${index + 1}`;
    const start = loop.start ?? loop.startNodeId;
    const end = loop.end ?? loop.endNodeId;
    if (!(id && start && end)) return [];
    return [{
      ...(loop.backTo ?? loop.backToNodeId ? { backTo: loop.backTo ?? loop.backToNodeId } : {}),
      end,
      id,
      ...(loop.label ? { label: loop.label } : {}),
      start,
    }];
  });
}

function endpointId(
  id: string | undefined,
  triggerDocumentId: string | undefined,
  endDocumentId: string | undefined,
  triggerId: string,
  endId: string,
) {
  if (!id) return "";
  if (id === triggerDocumentId) return triggerId;
  if (id === endDocumentId) return endId;
  return id;
}
