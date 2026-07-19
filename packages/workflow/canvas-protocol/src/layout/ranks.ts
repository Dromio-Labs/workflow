import type { WorkflowRenderModel, WorkflowRenderNode } from "../render.js";

export function workflowNodeRanks(model: WorkflowRenderModel): Map<string, number> {
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  const loopEdges = new Set(model.loops.map((loop) => `${loop.end}->${loop.backTo ?? loop.start}`));
  const incomingCount = new Map(model.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(model.nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of model.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (loopEdges.has(`${edge.source}->${edge.target}`)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const sourceOrder = new Map(model.nodes.map((node, index) => [node.id, index]));
  const queue = model.nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort((left, right) => sourceIndex(sourceOrder, left.id) - sourceIndex(sourceOrder, right.id))
    .map((node) => node.id);
  const rankById = new Map(queue.map((id) => [id, 0]));

  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]!;
    const nextRank = (rankById.get(source) ?? 0) + 1;
    for (const target of outgoing.get(source) ?? []) {
      rankById.set(target, Math.max(rankById.get(target) ?? 0, nextRank));
      incomingCount.set(target, (incomingCount.get(target) ?? 1) - 1);
      if (incomingCount.get(target) === 0) queue.push(target);
    }
  }

  let fallbackRank = Math.max(0, ...rankById.values()) + 1;
  for (const node of model.nodes) {
    if (rankById.has(node.id)) continue;
    rankById.set(node.id, fallbackRank);
    fallbackRank += 1;
  }
  return rankById;
}

export function orderedRankNodes(model: WorkflowRenderModel, ranks: Map<string, number>) {
  const byRank = new Map<number, WorkflowRenderNode[]>();
  const sourceOrder = new Map(model.nodes.map((node, index) => [node.id, index]));
  for (const node of model.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const nodes = byRank.get(rank) ?? [];
    nodes.push(node);
    byRank.set(rank, nodes);
  }

  const incoming = neighbors(model, "incoming");
  const outgoing = neighbors(model, "outgoing");
  const rankKeys = [...byRank.keys()].sort((left, right) => left - right);
  for (let pass = 0; pass < 4; pass += 1) {
    const forward = pass % 2 === 0;
    const keys = forward ? rankKeys : [...rankKeys].reverse();
    const positions = nodePositions(byRank);
    for (const rank of keys) {
      const nodes = byRank.get(rank) ?? [];
      const adjacent = forward ? incoming : outgoing;
      nodes.sort((left, right) => {
        const delta = barycenter(adjacent.get(left.id), positions) - barycenter(adjacent.get(right.id), positions);
        return delta || sourceIndex(sourceOrder, left.id) - sourceIndex(sourceOrder, right.id);
      });
    }
  }
  return byRank;
}

function neighbors(model: WorkflowRenderModel, direction: "incoming" | "outgoing") {
  const result = new Map(model.nodes.map((node) => [node.id, [] as string[]]));
  const loopEdges = new Set(model.loops.map((loop) => `${loop.end}->${loop.backTo ?? loop.start}`));
  for (const edge of model.edges) {
    if (loopEdges.has(`${edge.source}->${edge.target}`)) continue;
    const key = direction === "incoming" ? edge.target : edge.source;
    const value = direction === "incoming" ? edge.source : edge.target;
    result.get(key)?.push(value);
  }
  return result;
}

function nodePositions(byRank: Map<number, WorkflowRenderNode[]>) {
  const positions = new Map<string, number>();
  for (const nodes of byRank.values()) {
    nodes.forEach((node, index) => positions.set(node.id, index));
  }
  return positions;
}

function barycenter(ids: string[] | undefined, positions: Map<string, number>) {
  const values = (ids ?? []).flatMap((id) => positions.has(id) ? [positions.get(id)!] : []);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.POSITIVE_INFINITY;
}

function sourceIndex(order: Map<string, number>, id: string) {
  return order.get(id) ?? Number.MAX_SAFE_INTEGER;
}
