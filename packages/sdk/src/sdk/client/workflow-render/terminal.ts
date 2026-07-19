import {
  computeWorkflowRenderLayout,
  workflowRenderLayoutProfiles,
  type WorkflowRenderLayout,
  type WorkflowRenderLayoutBox,
  type WorkflowRenderLayoutEdge,
  type WorkflowRenderLayoutProfile,
} from "./layout.js";
import type {
  WorkflowRenderModel,
  WorkflowRenderNodeSemantic,
} from "./types.js";
import { workflowRenderSemanticLabel } from "@dromio/workflow-canvas-protocol";

export type WorkflowRenderTerminalNodeDetail = {
  glyph?: string;
  label?: string;
  selected?: boolean;
  status?: string;
};

export type WorkflowRenderTerminalOutput = {
  layout: WorkflowRenderLayout;
  lines: string[];
};

export function renderWorkflowLayoutToTerminal(input: {
  model: WorkflowRenderModel;
  nodeDetails?: Map<string, WorkflowRenderTerminalNodeDetail>;
  profile?: WorkflowRenderLayoutProfile;
  width?: number;
}): WorkflowRenderTerminalOutput {
  const profile = input.profile ?? workflowTerminalLayoutProfile(input.width ?? 96);
  const layout = computeWorkflowRenderLayout(input.model, profile);
  const width = Math.max(input.width ?? 0, Math.ceil(layout.width));
  const height = Math.max(4, Math.ceil(layout.height));
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
  const boxById = new Map(layout.boxes.map((box) => [box.id, box]));
  const semanticByBoxId = workflowSemanticByLayoutId(input.model);

  for (const box of layout.boxes.filter(isContainerBox)) {
    drawBox(rows, box, box.kind === "loop-group" ? `loop ${box.label}` : box.label, "dotted");
  }
  for (const edge of layout.edges) {
    const source = boxById.get(edge.sourceBoxId);
    const target = boxById.get(edge.targetBoxId);
    if (source && target) drawEdge(rows, source, target, edge);
  }
  for (const box of layout.boxes.filter((item) => !isContainerBox(item))) {
    const detail = detailForBox(box, input.nodeDetails);
    const semantic = semanticByBoxId.get(box.id);
    const semanticLabel = semantic ? workflowRenderSemanticLabel(semantic) : box.kind;
    const label = `${detail.label ?? box.label} · ${semanticLabel}`;
    const glyph = detail.glyph ?? (semantic ? glyphForSemantic(semantic) : "□");
    const selected = detail.selected ? ">" : " ";
    const status = detail.status ? ` ${detail.status}` : "";
    drawBox(rows, box, truncate(`${selected} ${glyph} ${label}${status}`, Math.max(1, box.width - 2)), "solid");
  }

  return {
    layout,
    lines: rows.map((row) => row.join("").trimEnd()),
  };
}

export function workflowTerminalLayoutProfile(width: number): WorkflowRenderLayoutProfile {
  const nodeWidth = Math.min(42, Math.max(18, width - 4));
  return {
    ...workflowRenderLayoutProfiles.terminal,
    child: {
      groupGap: 1,
      headerHeight: 1,
      loopInset: 1,
      padding: 1,
    },
    gap: { x: 2, y: 1 },
    minCanvasSize: { height: 12, width: Math.max(48, width) },
    nodeSize: { height: 3, width: nodeWidth },
    start: { x: 1, y: 0 },
  };
}

function detailForBox(
  box: WorkflowRenderLayoutBox,
  nodeDetails: Map<string, WorkflowRenderTerminalNodeDetail> | undefined,
) {
  return nodeDetails?.get(box.id) ??
    (box.sourceNodeId ? nodeDetails?.get(box.sourceNodeId) : undefined) ??
    {};
}

function drawBox(
  rows: string[][],
  box: WorkflowRenderLayoutBox,
  label: string,
  variant: "dotted" | "solid",
) {
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  if (width < 3 || height < 2) return;

  const horizontal = variant === "dotted" ? "·" : "─";
  const vertical = variant === "dotted" ? ":" : "│";
  writeAt(rows, left, top, `╭${horizontal.repeat(Math.max(0, width - 2))}╮`);
  for (let row = top + 1; row < top + height - 1; row += 1) {
    writeAt(rows, left, row, vertical);
    writeAt(rows, left + width - 1, row, vertical);
  }
  writeAt(rows, left, top + height - 1, `╰${horizontal.repeat(Math.max(0, width - 2))}╯`);
  writeAt(rows, left + 1, top + Math.max(1, Math.floor(height / 2)), truncate(label, Math.max(1, width - 2)));
}

function drawEdge(
  rows: string[][],
  source: WorkflowRenderLayoutBox,
  target: WorkflowRenderLayoutBox,
  edge: WorkflowRenderLayoutEdge,
) {
  const kind = edge.kind;
  const sourceX = Math.round(source.x + source.width / 2);
  const sourceY = Math.round(source.y + source.height);
  const targetX = Math.round(target.x + target.width / 2);
  const targetY = Math.round(target.y - 1);
  const dotted = kind === "loop" || kind === "composition";
  const vertical = dotted ? "┊" : "│";
  if (Math.abs(sourceX - targetX) <= 1) {
    drawVertical(rows, sourceX, sourceY, targetY, vertical);
    writeAt(rows, targetX, targetY, kind === "loop" ? "▲" : "▼");
    const label = terminalEdgeLabel(edge);
    if (label) writeAt(rows, sourceX + 1, sourceY + Math.trunc((targetY - sourceY) / 2), ` ${label}`);
    return;
  }
  const bendY = sourceY + Math.trunc((targetY - sourceY) / 2);
  drawVertical(rows, sourceX, sourceY, bendY, vertical);
  drawHorizontal(rows, Math.min(sourceX, targetX), Math.max(sourceX, targetX), bendY, dotted ? "╌" : "─");
  drawVertical(rows, targetX, bendY, targetY, vertical);
  writeAt(rows, targetX, targetY, kind === "loop" ? "▲" : "▼");
  const label = terminalEdgeLabel(edge);
  if (label) writeAt(rows, Math.min(sourceX, targetX) + 1, bendY, ` ${label} `);
}

function terminalEdgeLabel(edge: WorkflowRenderLayoutEdge) {
  if (edge.semantic.role === "route") {
    return `${edge.semantic.route.selected ? "✓ " : ""}${edge.semantic.route.label}`;
  }
  if (edge.semantic.role === "branch") return edge.semantic.branch.label;
  if (edge.semantic.role === "join") return `${edge.semantic.policy} join`;
  if (edge.semantic.role === "merge") return "merge";
  return edge.label;
}

function drawVertical(rows: string[][], x: number, fromY: number, toY: number, char: string) {
  const lower = Math.min(fromY, toY);
  const upper = Math.max(fromY, toY);
  for (let y = lower; y <= upper; y += 1) writeAt(rows, x, y, char);
}

function drawHorizontal(rows: string[][], fromX: number, toX: number, y: number, char: string) {
  for (let x = fromX; x <= toX; x += 1) writeAt(rows, x, y, char);
}

function writeAt(rows: string[][], x: number, y: number, value: string) {
  if (y < 0 || y >= rows.length) return;
  for (let index = 0; index < value.length; index += 1) {
    const column = x + index;
    if (column >= 0 && column < rows[y]!.length) rows[y]![column] = value[index]!;
  }
}

function isContainerBox(box: WorkflowRenderLayoutBox) {
  return box.kind === "child-group" || box.kind === "loop-group";
}

function glyphForSemantic(semantic: WorkflowRenderNodeSemantic) {
  if (semantic.role === "boundary") return "●";
  if (semantic.role === "trigger") return "▶";
  if (semantic.role === "terminal") return semantic.outcome === "result" ? "■" : "!";
  if (semantic.role === "router") return "◇";
  if (semantic.role === "fork") return "⑂";
  if (semantic.role === "join") return "⋈";
  if (semantic.role === "merge") return "▽";
  if (semantic.role === "interaction") {
    if (semantic.interactionKind === "approval") return "?";
    if (semantic.interactionKind === "timer") return "◷";
    return "¿";
  }
  if (semantic.role === "model") return "✦";
  if (semantic.role === "evaluation") return "◉";
  if (semantic.role === "gate") return "◆";
  if (semantic.role === "workflow") return "◆";
  if (semantic.role === "group") return "◇";
  return "□";
}

function workflowSemanticByLayoutId(model: WorkflowRenderModel, prefix = "") {
  const result = new Map<string, WorkflowRenderNodeSemantic>();
  for (const node of model.nodes) {
    const layoutId = `${prefix}${node.id}`;
    result.set(layoutId, node.semantic);
    if (!node.childWorkflow) continue;
    for (const [id, semantic] of workflowSemanticByLayoutId(node.childWorkflow.model, `${layoutId}:child:`)) {
      result.set(id, semantic);
    }
  }
  return result;
}

function truncate(value: string, width: number) {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}
