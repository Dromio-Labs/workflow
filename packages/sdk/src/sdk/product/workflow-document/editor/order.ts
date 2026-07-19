import type {
  WorkflowDocument,
  WorkflowDocumentEdge,
  WorkflowDocumentNode,
} from "../schema.js";

export function orderedNodes(document: WorkflowDocument) {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const predecessors = new Map<string, Set<string>>();
  for (const node of document.nodes) predecessors.set(node.id, new Set());
  for (const edge of document.edges) {
    if (!byId.has(edge.target)) continue;
    predecessors.get(edge.target)?.add(edge.source);
  }

  const ordered: WorkflowDocumentNode[] = [];
  const available = new Set([document.trigger.id]);
  while (ordered.length < document.nodes.length) {
    const next = document.nodes.find((node) => {
      if (available.has(node.id)) return false;
      const required = predecessors.get(node.id) ?? new Set();
      return [...required].every((id) => available.has(id) || !byId.has(id));
    });
    if (!next) {
      throw new Error("Workflow document contains a cycle or unreachable dependency.");
    }
    ordered.push(next);
    available.add(next.id);
  }
  return ordered;
}

export function sequenceEdges(
  triggerId: string,
  nodes: WorkflowDocumentNode[],
  endId: string,
): WorkflowDocumentEdge[] {
  const ids = [triggerId, ...nodes.map((node) => node.id), endId];
  return ids.slice(1).map((id, index) => ({
    id: `${ids[index]}->${id}`,
    source: ids[index]!,
    target: id,
  }));
}

export function insertNode(
  nodes: WorkflowDocumentNode[],
  node: WorkflowDocumentNode,
  input: { after?: string; before?: string },
) {
  if (input.before && input.after) {
    throw new Error("Use before or after when inserting a workflow node, not both.");
  }
  const next = [...nodes];
  if (input.before) {
    const index = next.findIndex((item) => item.id === input.before);
    if (index < 0) throw new Error(`Unknown before node ${input.before}.`);
    next.splice(index, 0, node);
    return next;
  }
  if (input.after) {
    const index = next.findIndex((item) => item.id === input.after);
    if (index < 0) throw new Error(`Unknown after node ${input.after}.`);
    next.splice(index + 1, 0, node);
    return next;
  }
  next.push(node);
  return next;
}

export function ensureUniqueNodeId(document: WorkflowDocument, nodeId: string) {
  if (document.trigger.id === nodeId || document.end.id === nodeId || document.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`Workflow document already has node id ${nodeId}.`);
  }
}

export function reachableIds(document: WorkflowDocument) {
  const edgesBySource = new Map<string, WorkflowDocumentEdge[]>();
  for (const edge of document.edges) {
    const edges = edgesBySource.get(edge.source) ?? [];
    edges.push(edge);
    edgesBySource.set(edge.source, edges);
  }
  const reachable = new Set<string>();
  const queue = [document.trigger.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of edgesBySource.get(id) ?? []) {
      queue.push(edge.target);
    }
  }
  return reachable;
}
