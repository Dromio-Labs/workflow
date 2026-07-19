import type { WorkflowRenderLayoutBox, WorkflowRenderLayoutPoint } from "./types.js";

export function layoutBounds(boxes: WorkflowRenderLayoutBox[], routes: WorkflowRenderLayoutPoint[][] = []) {
  const points = routes.flat();
  if (!boxes.length && !points.length) return { height: 0, width: 0, x: 0, y: 0 };
  const minX = Math.min(...boxes.map((box) => box.x), ...points.map((point) => point.x));
  const minY = Math.min(...boxes.map((box) => box.y), ...points.map((point) => point.y));
  const maxRight = Math.max(...boxes.map((box) => box.x + box.width), ...points.map((point) => point.x));
  const maxBottom = Math.max(...boxes.map((box) => box.y + box.height), ...points.map((point) => point.y));
  return { height: maxBottom - minY, width: maxRight - minX, x: minX, y: minY };
}

export function offsetBoxes(boxes: WorkflowRenderLayoutBox[], dx: number, dy: number, parentId?: string) {
  return boxes.map((box) => ({
    ...box,
    ...(parentId && !box.parentId ? { parentId } : {}),
    x: box.x + dx,
    y: box.y + dy,
  }));
}

export function compactPoints(points: WorkflowRenderLayoutPoint[]) {
  const compact: WorkflowRenderLayoutPoint[] = [];
  for (const point of points) {
    const previous = compact.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) compact.push(point);
  }
  return compact;
}

export function boxCenter(box: WorkflowRenderLayoutBox): WorkflowRenderLayoutPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
