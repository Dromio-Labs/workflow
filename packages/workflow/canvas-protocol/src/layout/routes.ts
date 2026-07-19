import type { WorkflowRenderEdge, WorkflowRenderModel } from "../render.js";
import { boxCenter, compactPoints, layoutBounds } from "./geometry.js";
import type {
  WorkflowRenderLayoutBox,
  WorkflowRenderLayoutEdge,
  WorkflowRenderLayoutEdgeKind,
  WorkflowRenderLayoutPoint,
  WorkflowRenderLayoutProfile,
} from "./types.js";

export function routeModelEdges(
  model: WorkflowRenderModel,
  boxes: WorkflowRenderLayoutBox[],
  profile: WorkflowRenderLayoutProfile,
): WorkflowRenderLayoutEdge[] {
  const bySourceId = new Map<string, WorkflowRenderLayoutBox>();
  for (const box of boxes) {
    if (box.sourceNodeId && !box.parentId) bySourceId.set(box.sourceNodeId, box);
  }
  const outgoing = counts(model.edges, "source");
  const incoming = counts(model.edges, "target");
  const edges = model.edges.flatMap((edge) => {
    const source = bySourceId.get(edge.source);
    const target = bySourceId.get(edge.target);
    if (!source || !target) return [];
    const kind = edgeKind(edge);
    return [{
      id: edge.id,
      kind,
      ...(edge.label ? { label: edge.label } : {}),
      points: routeForward(source, target, profile, outgoing.get(edge.source) ?? 0, incoming.get(edge.target) ?? 0),
      semantic: edge.semantic,
      sourceBoxId: source.id,
      targetBoxId: target.id,
    } satisfies WorkflowRenderLayoutEdge];
  });

  const bounds = layoutBounds(boxes);
  for (const loop of model.loops) {
    const source = bySourceId.get(loop.end);
    const target = bySourceId.get(loop.backTo ?? loop.start);
    if (!source || !target) continue;
    edges.push({
      id: `loop:${loop.id}`,
      kind: "loop",
      ...(loop.label ? { label: loop.label } : {}),
      points: routeLoop(source, target, profile, bounds.x - profile.child.loopInset * 2),
      semantic: { role: "loop" },
      sourceBoxId: source.id,
      targetBoxId: target.id,
    });
  }
  return edges;
}

export function routeCompositionEdge(
  id: string,
  source: WorkflowRenderLayoutBox,
  target: WorkflowRenderLayoutBox,
  profile: WorkflowRenderLayoutProfile,
): WorkflowRenderLayoutEdge {
  return {
    id,
    kind: "composition",
    points: routeForward(source, target, profile, 1, 1),
    semantic: { role: "composition" },
    sourceBoxId: source.id,
    targetBoxId: target.id,
  };
}

function routeForward(
  source: WorkflowRenderLayoutBox,
  target: WorkflowRenderLayoutBox,
  profile: WorkflowRenderLayoutProfile,
  outgoingCount: number,
  incomingCount: number,
) {
  const sourceCenter = boxCenter(source);
  const targetCenter = boxCenter(target);
  if (profile.direction === "LR") {
    const start = { x: source.x + source.width, y: sourceCenter.y };
    const end = { x: target.x, y: targetCenter.y };
    const sourceBus = start.x + Math.min(profile.gap.x / 3, profile.routeClearance * 2);
    const targetBus = end.x - Math.min(profile.gap.x / 3, profile.routeClearance * 2);
    const middle = (sourceBus + targetBus) / 2;
    const sourceLane = outgoingCount > 1 ? sourceBus : middle;
    const targetLane = incomingCount > 1 ? targetBus : middle;
    return compactPoints([
      start,
      { x: sourceLane, y: start.y },
      { x: sourceLane, y: end.y },
      { x: targetLane, y: end.y },
      end,
    ]);
  }
  const start = { x: sourceCenter.x, y: source.y + source.height };
  const end = { x: targetCenter.x, y: target.y };
  const sourceBus = start.y + Math.min(profile.gap.y / 3, profile.routeClearance * 2);
  const targetBus = end.y - Math.min(profile.gap.y / 3, profile.routeClearance * 2);
  const middle = (sourceBus + targetBus) / 2;
  const sourceLane = outgoingCount > 1 ? sourceBus : middle;
  const targetLane = incomingCount > 1 ? targetBus : middle;
  return compactPoints([
    start,
    { x: start.x, y: sourceLane },
    { x: end.x, y: sourceLane },
    { x: end.x, y: targetLane },
    end,
  ]);
}

function routeLoop(
  source: WorkflowRenderLayoutBox,
  target: WorkflowRenderLayoutBox,
  profile: WorkflowRenderLayoutProfile,
  outside: number,
): WorkflowRenderLayoutPoint[] {
  if (profile.direction === "LR") {
    const start = { x: source.x, y: boxCenter(source).y };
    const end = { x: target.x, y: boxCenter(target).y };
    return compactPoints([start, { x: outside, y: start.y }, { x: outside, y: end.y }, end]);
  }
  const above = Math.min(source.y, target.y) - profile.child.loopInset * 2;
  const start = { x: boxCenter(source).x, y: source.y };
  const end = { x: boxCenter(target).x, y: target.y };
  return compactPoints([start, { x: start.x, y: above }, { x: end.x, y: above }, end]);
}

function counts(edges: WorkflowRenderEdge[], key: "source" | "target") {
  const result = new Map<string, number>();
  for (const edge of edges) result.set(edge[key], (result.get(edge[key]) ?? 0) + 1);
  return result;
}

function edgeKind(edge: WorkflowRenderEdge): WorkflowRenderLayoutEdgeKind {
  if (edge.semantic.role === "branch") return "fork";
  return edge.semantic.role;
}
