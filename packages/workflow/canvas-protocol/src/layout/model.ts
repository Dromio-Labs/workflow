import type { WorkflowRenderModel } from "../render.js";
import { layoutBounds, offsetBoxes } from "./geometry.js";
import { orderedRankNodes, workflowNodeRanks } from "./ranks.js";
import { routeCompositionEdge, routeModelEdges } from "./routes.js";
import type {
  WorkflowRenderLayout,
  WorkflowRenderLayoutBox,
  WorkflowRenderLayoutEdge,
  WorkflowRenderLayoutProfile,
  WorkflowRenderNodeMeasurements,
} from "./types.js";

export function layoutWorkflowModel(
  model: WorkflowRenderModel,
  profile: WorkflowRenderLayoutProfile,
  measurements: WorkflowRenderNodeMeasurements,
): Omit<WorkflowRenderLayout, "profile"> {
  const boxes = layoutRankBoxes(model, profile, measurements);
  const edges = routeModelEdges(model, boxes, profile);
  let crossCursor = crossAxisEnd(boxes, profile) + profile.child.groupGap;

  for (const parent of model.nodes) {
    if (!parent.childWorkflow) continue;
    const parentBox = boxes.find((box) => !box.parentId && box.sourceNodeId === parent.id);
    if (!parentBox) continue;
    const child = layoutWorkflowModel(parent.childWorkflow.model, profile, measurements);
    const childBounds = layoutBounds(child.boxes, child.edges.map((edge) => edge.points));
    const groupId = `${parentBox.id}:child-group`;
    const groupSize = {
      height: childBounds.height + profile.child.headerHeight + profile.child.padding * 2,
      width: Math.max(parentBox.width, childBounds.width + profile.child.padding * 2),
    };
    const groupPoint = childGroupPoint(parentBox, groupSize, crossCursor, profile);
    const groupBox: WorkflowRenderLayoutBox = {
      ...groupPoint,
      ...groupSize,
      childWorkflowId: parent.childWorkflow.id,
      id: groupId,
      kind: "child-group",
      label: parent.childWorkflow.label,
      loops: parent.childWorkflow.model.loops,
      modelId: model.id,
      sourceNodeId: parent.id,
      zIndex: 0,
    };
    boxes.push(groupBox);
    const dx = groupBox.x + profile.child.padding - childBounds.x;
    const dy = groupBox.y + profile.child.headerHeight + profile.child.padding - childBounds.y;
    const childIdById = new Map(child.boxes.map((box) => [
      box.id,
      `${parentBox.id}:child:${box.id}`,
    ]));
    const childBoxes = offsetBoxes(child.boxes, dx, dy).map((box) => ({
      ...box,
      id: childIdById.get(box.id)!,
      parentId: box.parentId ? childIdById.get(box.parentId) ?? groupId : groupId,
    }));
    boxes.push(...childBoxes);
    const childEdges = child.edges.map((edge) => ({
      ...edge,
      id: `${parentBox.id}:child:${edge.id}`,
      points: edge.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      sourceBoxId: childIdById.get(edge.sourceBoxId)!,
      targetBoxId: childIdById.get(edge.targetBoxId)!,
    }));
    edges.push(...childEdges);
    const entry = childBoxes.find((box) => box.parentId === groupId && box.kind === "initial")
      ?? childBoxes.find((box) => box.parentId === groupId && box.kind === "trigger");
    if (entry) edges.push(routeCompositionEdge(`${parentBox.id}->${entry.id}:composition`, parentBox, entry, profile));
    crossCursor = crossAxisPosition(groupBox, profile) + crossAxisSize(groupBox, profile) + profile.child.groupGap;
  }

  addLoopGroups(model, boxes, profile);
  const normalized = normalizeLayout(boxes, edges, profile);
  return { boxes: normalized.boxes, edges: normalized.edges, height: normalized.height, width: normalized.width };
}

function layoutRankBoxes(
  model: WorkflowRenderModel,
  profile: WorkflowRenderLayoutProfile,
  measurements: WorkflowRenderNodeMeasurements,
) {
  const ranks = workflowNodeRanks(model);
  const byRank = orderedRankNodes(model, ranks);
  const rankKeys = [...byRank.keys()].sort((left, right) => left - right);
  const rankMainSizes = rankKeys.map((rank) => Math.max(...(byRank.get(rank) ?? []).map((node) => mainSize(sizeFor(node.id, profile, measurements), profile))));
  const rankCrossSizes = rankKeys.map((rank) => (byRank.get(rank) ?? []).reduce(
    (total, node, index) => total + crossSize(sizeFor(node.id, profile, measurements), profile) + (index ? crossGap(profile) : 0),
    0,
  ));
  const maxCross = Math.max(0, ...rankCrossSizes);
  const boxes: WorkflowRenderLayoutBox[] = [];
  let main = mainStart(profile);
  rankKeys.forEach((rank, rankIndex) => {
    const nodes = byRank.get(rank) ?? [];
    let cross = crossStart(profile) + (maxCross - rankCrossSizes[rankIndex]!) / 2;
    for (const node of nodes) {
      const size = sizeFor(node.id, profile, measurements);
      const point = profile.direction === "LR" ? { x: main, y: cross } : { x: cross, y: main };
      boxes.push({
        ...point,
        ...size,
        id: node.id,
        kind: node.kind,
        label: node.label,
        modelId: model.id,
        sourceNodeId: node.id,
        zIndex: 1,
      });
      cross += crossSize(size, profile) + crossGap(profile);
    }
    main += rankMainSizes[rankIndex]! + mainGap(profile);
  });
  return boxes;
}

function addLoopGroups(model: WorkflowRenderModel, boxes: WorkflowRenderLayoutBox[], profile: WorkflowRenderLayoutProfile) {
  const byId = new Map(boxes.filter((box) => !box.parentId).map((box) => [box.sourceNodeId, box]));
  for (const loop of model.loops) {
    const start = byId.get(loop.start);
    const end = byId.get(loop.end);
    if (!start || !end) continue;
    const bounds = layoutBounds([start, end]);
    const inset = profile.child.loopInset;
    boxes.push({
      height: bounds.height + inset * 2,
      id: `loop-group:${loop.id}`,
      kind: "loop-group",
      label: loop.label ?? loop.id,
      loopId: loop.id,
      modelId: model.id,
      width: bounds.width + inset * 2,
      x: bounds.x - inset,
      y: bounds.y - inset,
      zIndex: 0,
    });
  }
}

function normalizeLayout(
  boxes: WorkflowRenderLayoutBox[],
  edges: WorkflowRenderLayoutEdge[],
  profile: WorkflowRenderLayoutProfile,
) {
  const bounds = layoutBounds(boxes, edges.map((edge) => edge.points));
  const dx = Math.max(0, profile.start.x - bounds.x);
  const dy = Math.max(0, profile.start.y - bounds.y);
  const movedBoxes = offsetBoxes(boxes, dx, dy);
  const movedEdges = edges.map((edge) => ({
    ...edge,
    points: edge.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  }));
  const movedBounds = layoutBounds(movedBoxes, movedEdges.map((edge) => edge.points));
  return {
    boxes: movedBoxes,
    edges: movedEdges,
    height: Math.max(profile.minCanvasSize.height, movedBounds.y + movedBounds.height + profile.start.y),
    width: Math.max(profile.minCanvasSize.width, movedBounds.x + movedBounds.width + profile.start.x),
  };
}

function childGroupPoint(
  parent: WorkflowRenderLayoutBox,
  size: { height: number; width: number },
  cursor: number,
  profile: WorkflowRenderLayoutProfile,
) {
  return profile.direction === "LR"
    ? { x: Math.max(profile.start.x, parent.x + parent.width / 2 - size.width / 2), y: cursor }
    : { x: cursor, y: Math.max(profile.start.y, parent.y + parent.height / 2 - size.height / 2) };
}

function sizeFor(id: string, profile: WorkflowRenderLayoutProfile, measurements: WorkflowRenderNodeMeasurements) {
  return measurements[id] ?? profile.nodeSize;
}

function mainSize(size: { height: number; width: number }, profile: WorkflowRenderLayoutProfile) {
  return profile.direction === "LR" ? size.width : size.height;
}

function crossSize(size: { height: number; width: number }, profile: WorkflowRenderLayoutProfile) {
  return profile.direction === "LR" ? size.height : size.width;
}

function mainStart(profile: WorkflowRenderLayoutProfile) {
  return profile.direction === "LR" ? profile.start.x : profile.start.y;
}

function crossStart(profile: WorkflowRenderLayoutProfile) {
  return profile.direction === "LR" ? profile.start.y : profile.start.x;
}

function mainGap(profile: WorkflowRenderLayoutProfile) {
  return profile.direction === "LR" ? profile.gap.x : profile.gap.y;
}

function crossGap(profile: WorkflowRenderLayoutProfile) {
  return profile.direction === "LR" ? profile.gap.y : profile.gap.x;
}

function crossAxisPosition(box: WorkflowRenderLayoutBox, profile: WorkflowRenderLayoutProfile) {
  return profile.direction === "LR" ? box.y : box.x;
}

function crossAxisSize(box: WorkflowRenderLayoutBox, profile: WorkflowRenderLayoutProfile) {
  return profile.direction === "LR" ? box.height : box.width;
}

function crossAxisEnd(boxes: WorkflowRenderLayoutBox[], profile: WorkflowRenderLayoutProfile) {
  return Math.max(crossStart(profile), ...boxes.map((box) => crossAxisPosition(box, profile) + crossAxisSize(box, profile)));
}
