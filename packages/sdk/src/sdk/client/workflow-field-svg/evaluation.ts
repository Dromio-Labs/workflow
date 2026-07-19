import { easeOut, svgElement, svgText } from "./dom.js";
import type { WorkflowFieldEvaluationState } from "./types.js";

type EvaluationAnchor = {
  x: number;
  y: number;
};

export type WorkflowFieldEvaluationHud = {
  dispose(): void;
  setState(evaluation?: WorkflowFieldEvaluationState): void;
  update(now: number): void;
};

const RADIUS = 27;
const CIRCUMFERENCE = Math.PI * 2 * RADIUS;

export function createWorkflowFieldEvaluationHud(
  parent: SVGElement,
  anchorFor: (nodeId: string) => EvaluationAnchor | undefined,
): WorkflowFieldEvaluationHud {
  const group = svgElement("g", { class: "workflow-field-evaluation", opacity: 0 }, parent);
  const track = svgElement("circle", { class: "workflow-field-evaluation-track", r: RADIUS }, group);
  const arc = svgElement("circle", {
    class: "workflow-field-evaluation-arc",
    r: RADIUS,
    transform: "rotate(-90)",
  }, group);
  const threshold = svgElement("line", { class: "workflow-field-evaluation-threshold" }, group);
  const score = svgText(group, 38, -2, "", { class: "workflow-field-evaluation-score" });
  const label = svgText(group, 38, 11, "", { class: "workflow-field-evaluation-label" });
  const attempt = svgText(group, 38, 23, "", { class: "workflow-field-evaluation-attempt" });
  track.setAttribute("stroke-dasharray", String(CIRCUMFERENCE));
  arc.setAttribute("stroke-dasharray", `0 ${CIRCUMFERENCE}`);

  let current: WorkflowFieldEvaluationState | undefined;
  let displayedScore = 0;
  let startedAt = 0;
  let startingScore = 0;

  function setState(next?: WorkflowFieldEvaluationState) {
    if (!next) {
      current = undefined;
      group.setAttribute("opacity", "0");
      return;
    }
    const anchor = anchorFor(next.nodeId);
    if (!anchor) {
      current = undefined;
      group.setAttribute("opacity", "0");
      return;
    }
    const changed = !current || current.nodeId !== next.nodeId || current.score !== next.score || current.attempt !== next.attempt;
    if (changed) {
      startingScore = current?.nodeId === next.nodeId ? displayedScore : 0;
      startedAt = performance.now();
    }
    current = next;
    group.setAttribute("transform", `translate(${anchor.x} ${anchor.y})`);
    group.setAttribute("data-result", passed(next) ? "pass" : "retry");
    group.setAttribute("opacity", "1");
    positionThreshold(threshold, next.threshold);
    renderText(score, label, attempt, next);
  }

  return {
    dispose() {
      group.remove();
    },
    setState,
    update(now) {
      if (!current) return;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / 1_500));
      displayedScore = startingScore + (current.score - startingScore) * easeOut(progress);
      const length = displayedScore * CIRCUMFERENCE;
      arc.setAttribute("stroke-dasharray", `${length.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`);
    },
  };
}

function renderText(
  score: SVGTextElement,
  label: SVGTextElement,
  attempt: SVGTextElement,
  evaluation: WorkflowFieldEvaluationState,
) {
  const isPass = passed(evaluation);
  score.textContent = `${isPass ? "✓ " : ""}${Math.round(evaluation.score * 100)}%`;
  label.textContent = isPass ? "pass" : "retry ↻";
  attempt.textContent = isPass
    ? `threshold ${Math.round(evaluation.threshold * 100)}%`
    : evaluation.attempt
      ? `attempt ${evaluation.attempt}`
      : `threshold ${Math.round(evaluation.threshold * 100)}%`;
}

function positionThreshold(line: SVGLineElement, threshold: number) {
  const angle = threshold * Math.PI * 2 - Math.PI / 2;
  line.setAttribute("x1", String(Math.cos(angle) * (RADIUS - 3)));
  line.setAttribute("y1", String(Math.sin(angle) * (RADIUS - 3)));
  line.setAttribute("x2", String(Math.cos(angle) * (RADIUS + 4)));
  line.setAttribute("y2", String(Math.sin(angle) * (RADIUS + 4)));
}

function passed(evaluation: WorkflowFieldEvaluationState) {
  return evaluation.status === "pass" && evaluation.score >= evaluation.threshold;
}
