import type {
  WorkflowRenderLayout,
  WorkflowRenderLayoutBox,
  WorkflowRenderModel,
  WorkflowRenderNode,
  WorkflowRenderStatus,
} from "../workflow-render/index.js";
import { workflowRenderSemanticLabel } from "../workflow-render/index.js";
import {
  clamp,
  easeOut,
  splinePath,
  svgElement,
  svgText,
} from "./dom.js";
import { createWorkflowFieldEvaluationHud } from "./evaluation.js";
import type {
  WorkflowFieldSvgGraphScene,
  WorkflowFieldSvgVariant,
  WorkflowFieldVisualState,
} from "./types.js";

type EdgeVisual = {
  dash: SVGPathElement;
  group: SVGGElement;
  path: SVGPathElement;
  sourceId?: string;
  targetId?: string;
};

type NodeVisual = {
  core: SVGCircleElement;
  glow: SVGCircleElement;
  group: SVGGElement;
  id: string;
  ring: SVGCircleElement;
  x: number;
  y: number;
};

type PulseVisual = {
  circle: SVGCircleElement;
  distance: number;
};

type Effect = (now: number, deltaSeconds: number) => boolean;

export function createWorkflowFieldGraphScene(
  svg: SVGSVGElement,
  model: WorkflowRenderModel,
  layout: WorkflowRenderLayout,
  variant: WorkflowFieldSvgVariant = "full",
): WorkflowFieldSvgGraphScene {
  const containersGroup = svgElement("g", { class: "workflow-field-containers" }, svg);
  const edgesGroup = svgElement("g", { class: "workflow-field-edges" }, svg);
  const nodesGroup = svgElement("g", { class: "workflow-field-nodes" }, svg);
  const effectsGroup = svgElement("g", { class: "workflow-field-effects" }, svg);
  const hudGroup = svgElement("g", { class: "workflow-field-hud" }, svg);
  const modelNodes = flattenNodes(model);
  const boxById = new Map(layout.boxes.map((box) => [box.id, box]));
  const edges = layout.edges.map((edge): EdgeVisual => {
    const selected = edge.semantic.role === "route" && edge.semantic.route.selected;
    const group = svgElement("g", {
      "aria-label": edgeAccessibleLabel(edge),
      class: "workflow-field-edge",
      "data-selected": String(selected),
      "data-semantic": edge.semantic.role,
      "data-status": "pending",
      role: "img",
      tabindex: edge.label ? 0 : -1,
    }, edgesGroup);
    const pathData = splinePath(edge.points);
    const path = svgElement("path", { class: "workflow-field-edge-base", d: pathData }, group);
    const dash = svgElement("path", { class: "workflow-field-edge-flow", d: pathData }, group);
    if (edge.label) {
      const point = edge.points[Math.floor(edge.points.length / 2)]!;
      svgText(group, point.x, point.y - 5, `${selected ? "✓ " : ""}${edge.label}`, {
        class: "workflow-field-edge-label",
        "text-anchor": "middle",
      });
    }
    return {
      dash,
      group,
      path,
      sourceId: boxById.get(edge.sourceBoxId)?.sourceNodeId,
      targetId: boxById.get(edge.targetBoxId)?.sourceNodeId,
    };
  });
  for (const box of layout.boxes.filter(isContainer)) renderContainer(containersGroup, box);
  const nodes = new Map(layout.boxes.filter((box) => !isContainer(box)).flatMap((box) => {
    const node = box.sourceNodeId ? modelNodes.get(`${box.modelId}:${box.sourceNodeId}`) : undefined;
    return node ? [[node.id, renderNode(nodesGroup, node, box, variant)] as const] : [];
  }));
  const effects: Effect[] = [];
  let state: WorkflowFieldVisualState = { activeNodeIds: [], elapsedMs: 0, phase: "idle", statuses: {} };
  const pulses = new Map<SVGPathElement, PulseVisual>();
  let waitingCard: ReturnType<typeof createHumanCard> | undefined;
  const evaluationHud = createWorkflowFieldEvaluationHud(hudGroup, (nodeId) => nodes.get(nodeId));

  function setState(next: WorkflowFieldVisualState) {
    for (const [nodeId, visual] of nodes) {
      const previous = state.statuses[nodeId] ?? "pending";
      const status = next.statuses[nodeId] ?? "pending";
      visual.group.dataset.status = status;
      if (previous !== status) transitionNode(visual, status, effectsGroup, effects);
    }
    for (const edge of edges) {
      edge.group.dataset.status = edgeStatus(edge, next.statuses);
    }
    reconcilePulses(
      effectsGroup,
      pulses,
      edges.filter((edge) => edge.targetId && next.activeNodeIds.includes(edge.targetId)).map((edge) => edge.path),
    );
    const waitingNode = [...nodes.values()].find((node) => next.statuses[node.id] === "waiting");
    if (next.phase === "waiting" && waitingNode) {
      if (!waitingCard) {
        waitingCard = createHumanCard(
          hudGroup,
          waitingNode,
          next.waitingLabel ?? "Waiting for human input",
          layout,
          next.waitingKind ?? "human",
        );
      }
    } else if (waitingCard) {
      waitingCard.resume(performance.now());
    }
    evaluationHud.setState(next.evaluation);
    state = next;
  }

  return {
    dispose() {
      containersGroup.remove();
      edgesGroup.remove();
      nodesGroup.remove();
      effectsGroup.remove();
      evaluationHud.dispose();
      for (const pulse of pulses.values()) pulse.circle.remove();
      pulses.clear();
      hudGroup.remove();
    },
    setState,
    update(now, deltaSeconds) {
      edges.forEach((edge, index) => {
        const speed = state.phase === "idle" ? 0 : pulses.has(edge.path) ? 24 : 11;
        edge.dash.setAttribute("stroke-dashoffset", String(-now * 0.001 * speed - index * 4));
      });
      for (const visual of nodes.values()) {
        const running = visual.group.dataset.status === "running";
        const waiting = visual.group.dataset.status === "waiting";
        const wobble = running || waiting ? 15 + Math.sin(now / 230 + visual.x) * 2.4 : 14;
        visual.glow.setAttribute("r", wobble.toFixed(2));
        visual.ring.setAttribute("stroke-dashoffset", String(-now / 80));
      }
      for (const [path, pulse] of pulses) {
        const visible = state.phase !== "idle" && state.phase !== "failed";
        pulse.circle.setAttribute("opacity", visible ? "1" : "0");
        if (!visible) continue;
        const length = path.getTotalLength();
        pulse.distance = (pulse.distance + deltaSeconds * 150) % Math.max(1, length);
        const point = path.getPointAtLength(pulse.distance);
        pulse.circle.setAttribute("cx", point.x.toFixed(1));
        pulse.circle.setAttribute("cy", point.y.toFixed(1));
      }
      for (let index = effects.length - 1; index >= 0; index -= 1) {
        if (!effects[index]!(now, deltaSeconds)) effects.splice(index, 1);
      }
      if (waitingCard && waitingCard.update(now)) waitingCard = undefined;
      evaluationHud.update(now);
    },
  };
}

function reconcilePulses(
  parent: SVGElement,
  pulses: Map<SVGPathElement, PulseVisual>,
  paths: readonly SVGPathElement[],
) {
  const desired = new Set(paths);
  for (const [path, pulse] of pulses) {
    if (desired.has(path)) continue;
    pulse.circle.remove();
    pulses.delete(path);
  }
  for (const path of desired) {
    if (pulses.has(path)) continue;
    const circle = svgElement("circle", { class: "workflow-field-pulse", opacity: 0, r: 2.8 }, parent);
    pulses.set(path, { circle, distance: 0 });
  }
}

function renderContainer(parent: SVGElement, box: WorkflowRenderLayoutBox) {
  const group = svgElement("g", { class: "workflow-field-container" }, parent);
  svgElement("rect", {
    height: box.height,
    rx: 14,
    width: box.width,
    x: box.x,
    y: box.y,
  }, group);
  svgText(group, box.x + 12, box.y + 18, box.label.toUpperCase());
}

function renderNode(
  parent: SVGElement,
  node: WorkflowRenderNode,
  box: WorkflowRenderLayoutBox,
  variant: WorkflowFieldSvgVariant,
): NodeVisual {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const group = svgElement("g", {
    "aria-label": `${node.label}, ${workflowRenderSemanticLabel(node.semantic)}, ${node.status ?? "pending"}`,
    class: "workflow-field-node",
    "data-kind": node.kind,
    "data-node-id": node.id,
    "data-semantic": node.semantic.role,
    "data-status": node.status ?? "pending",
    role: "img",
    tabindex: 0,
    transform: `translate(${x} ${y})`,
  }, parent);
  const glow = svgElement("circle", { class: "workflow-field-node-glow", r: 14 }, group);
  const ring = svgElement("circle", { class: "workflow-field-node-ring", r: 18 }, group);
  const core = svgElement("circle", { class: "workflow-field-node-core", r: 3.2 }, group);
  renderNodeShape(group, node, variant);
  return { core, glow, group, id: node.id, ring, x, y };
}

function renderNodeShape(group: SVGGElement, node: WorkflowRenderNode, variant: WorkflowFieldSvgVariant) {
  if (node.semantic.role === "boundary") {
    svgElement("circle", { class: "workflow-field-node-shape", r: 3.2 }, group);
    return;
  }
  if (node.semantic.role === "trigger") {
    if (variant === "mini") {
      svgElement("circle", { class: "workflow-field-node-shape", r: 5.2 }, group);
      return;
    }
    svgElement("rect", { class: "workflow-field-node-shape", height: 20, rx: 10, width: 88, x: -44, y: -10 }, group);
    svgText(group, 0, 3, shortLabel(node.label, 15), { class: "workflow-field-node-label" });
    return;
  }
  if (node.semantic.role === "terminal") {
    svgElement("circle", { class: "workflow-field-node-shape", r: 5.2 }, group);
  } else if (node.semantic.role === "router") {
    svgElement("polygon", { class: "workflow-field-node-shape", points: "0,-9 12,0 0,9 -12,0" }, group);
  } else if (node.semantic.role === "fork" || node.semantic.role === "join") {
    svgElement("rect", { class: "workflow-field-node-shape", height: 4, rx: 2, width: 28, x: -14, y: -2 }, group);
  } else if (node.semantic.role === "merge") {
    svgElement("polygon", { class: "workflow-field-node-shape", points: "-10,-7 10,-7 0,8" }, group);
  } else if (node.semantic.role === "interaction") {
    svgElement("circle", { class: "workflow-field-node-shape", r: 8 }, group);
    const interactionLabel = node.semantic.interactionKind === "approval"
      ? "✓?"
      : node.semantic.interactionKind === "timer" ? "◷" : "?";
    svgText(group, 0, 3, interactionLabel, { class: "workflow-field-node-label" });
  } else if (
    node.semantic.role === "model"
    || node.semantic.role === "evaluation"
    || node.semantic.role === "gate"
  ) {
    svgElement("circle", { class: "workflow-field-node-shape", r: 7 }, group);
    const label = node.semantic.role === "model" ? "✦" : node.semantic.role === "evaluation" ? "◉" : "◆";
    svgText(group, 0, 3, label, { class: "workflow-field-node-label" });
  } else if (node.semantic.role === "workflow") {
    svgElement("circle", { class: "workflow-field-node-shape", r: 7 }, group);
    svgElement("circle", { class: "workflow-field-node-shape", r: 3.5 }, group);
  } else {
    svgElement("rect", { class: "workflow-field-node-shape", height: 11, rx: 3, width: 11, x: -5.5, y: -5.5 }, group);
  }
  renderNodeLabel(group, node.label, variant);
}

function renderNodeLabel(
  group: SVGGElement,
  label: string,
  variant: WorkflowFieldSvgVariant,
) {
  const lines = variant === "mini" ? [shortLabel(label, 10)] : wrapLabel(label, 16);
  const text = svgElement("text", {
    class: "workflow-field-node-label",
    "text-anchor": "middle",
    x: 0,
    y: lines.length === 1 ? 21 : 18,
  }, group);
  for (const [index, line] of lines.entries()) {
    const span = svgElement("tspan", { dy: index === 0 ? 0 : 12, x: 0 }, text);
    span.textContent = line;
  }
}

function wrapLabel(value: string, maximum: number) {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maximum) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length <= 2) return lines;
  return [lines[0]!, shortLabel(lines.slice(1).join(" "), maximum)];
}

function edgeAccessibleLabel(edge: WorkflowRenderLayout["edges"][number]) {
  if (edge.semantic.role === "route") {
    return `${edge.semantic.route.label} route, ${edge.semantic.route.selected ? "selected" : "not selected"}`;
  }
  if (edge.semantic.role === "branch") return `${edge.semantic.branch.label} branch`;
  if (edge.semantic.role === "join") return `${edge.semantic.policy} join`;
  return edge.label ? `${edge.semantic.role}: ${edge.label}` : edge.semantic.role;
}

function transitionNode(
  node: NodeVisual,
  status: WorkflowRenderStatus,
  parent: SVGElement,
  effects: Effect[],
) {
  if (status === "running" || status === "waiting") popNode(node, effects);
  if (status === "completed") burst(parent, node.x, node.y, "#3ddc97", effects);
  if (status === "failed") burst(parent, node.x, node.y, "#fb7185", effects);
}

function popNode(node: NodeVisual, effects: Effect[]) {
  const startedAt = performance.now();
  effects.push((now) => {
    const progress = (now - startedAt) / 380;
    if (progress >= 1) {
      node.group.setAttribute("transform", `translate(${node.x} ${node.y})`);
      return false;
    }
    const scale = 1 + 0.7 * (1 - easeOut(progress));
    node.group.setAttribute("transform", `translate(${node.x} ${node.y}) scale(${scale.toFixed(3)})`);
    return true;
  });
}

function burst(parent: SVGElement, x: number, y: number, color: string, effects: Effect[]) {
  const circle = svgElement("circle", { cx: x, cy: y, fill: "none", r: 5, stroke: color, "stroke-width": 1.2 }, parent);
  const startedAt = performance.now();
  effects.push((now) => {
    const progress = (now - startedAt) / 760;
    if (progress >= 1) {
      circle.remove();
      return false;
    }
    circle.setAttribute("r", String(5 + 22 * easeOut(progress)));
    circle.setAttribute("stroke-opacity", String(0.7 * (1 - progress)));
    return true;
  });
}

function createHumanCard(
  parent: SVGElement,
  node: NodeVisual,
  label: string,
  layout: WorkflowRenderLayout,
  waitingKind: "human" | "signal",
) {
  const width = 176;
  const height = 62;
  const x = clamp(node.x + 24, 12, layout.width - width - 12);
  const y = clamp(node.y - height - 22, 12, layout.height - height - 12);
  const group = svgElement("g", { class: "workflow-field-human-card", opacity: 0 }, parent);
  svgElement("line", { x1: node.x, y1: node.y, x2: x, y2: y + height / 2 }, group);
  svgElement("rect", { height, rx: 8, width, x, y }, group);
  svgElement("line", { x1: x + 1, y1: y + 17, x2: x + width - 1, y2: y + 17 }, group);
  const title = svgText(group, x + 8, y + 12, waitingKind === "signal" ? "WAITING FOR SIGNAL" : "NEEDS A HUMAN", { class: "workflow-field-human-title" });
  svgText(group, x + 8, y + 35, shortLabel(label, 30), { class: "workflow-field-human-copy" });
  const timer = svgText(group, x + width - 8, y + 12, "0s", { class: "workflow-field-human-time" });
  const createdAt = performance.now();
  let resumedAt: number | undefined;
  return {
    resume(now: number) {
      if (resumedAt) return;
      resumedAt = now;
      title.textContent = "✓ ANSWERED · RESUMING";
      title.setAttribute("fill", "#3ddc97");
      timer.textContent = "";
    },
    update(now: number) {
      const age = now - createdAt;
      const opacity = resumedAt ? Math.max(0, 1 - (now - resumedAt) / 850) : Math.min(1, age / 260);
      group.setAttribute("opacity", opacity.toFixed(3));
      if (!resumedAt) timer.textContent = `${Math.floor(age / 1000)}s`;
      if (resumedAt && opacity === 0) {
        group.remove();
        return true;
      }
      return false;
    },
  };
}

function edgeStatus(edge: EdgeVisual, statuses: Readonly<Record<string, WorkflowRenderStatus>>) {
  const source = edge.sourceId ? statuses[edge.sourceId] : undefined;
  const target = edge.targetId ? statuses[edge.targetId] : undefined;
  if (source === "failed" || target === "failed") return "failed";
  if (source === "completed" && target === "completed") return "completed";
  if (source === "running" || target === "running" || target === "waiting") return "running";
  return "pending";
}

function flattenNodes(model: WorkflowRenderModel) {
  const result = new Map<string, WorkflowRenderNode>();
  for (const node of model.nodes) {
    result.set(`${model.id}:${node.id}`, node);
    if (node.childWorkflow) {
      for (const [key, child] of flattenNodes(node.childWorkflow.model)) result.set(key, child);
    }
  }
  return result;
}

function isContainer(box: WorkflowRenderLayoutBox) {
  return box.kind === "child-group" || box.kind === "loop-group";
}

function shortLabel(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}
