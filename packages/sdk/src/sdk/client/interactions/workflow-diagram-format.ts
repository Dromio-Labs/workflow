import type {
  LoopGraphChildNode,
} from "../../core/index.js";
import type {
  WorkflowRunStepStatus,
  WorkflowRunStepView,
} from "./workflow-run-projection.js";
import type {
  WorkflowRunSemanticRow,
} from "./workflow-run-store.js";

export function semanticStatus(status: WorkflowRunSemanticRow["status"]): WorkflowRunStepStatus {
  if (status === "ok") return "done";
  if (status === "error") return "failed";
  if (status === "running") return "running";
  return "pending";
}

export function stepLabel(step: WorkflowRunStepView) {
  const title = `${formatStepIndex(step)} ${displayText(step.label)}`;
  const detail = stepLabelDetail(step);
  return detail ? `${title}<br/>${detail}` : title;
}

export function childLabel(child: LoopGraphChildNode, fallbackIndex?: number) {
  return `${childLocalIndex(child, fallbackIndex)} ${displayText(child.label)}`;
}

export function stepLabelDetail(step: WorkflowRunStepView) {
  const execution = step.catalog?.execution;
  if (execution?.kind === "forEach") return execution.label ?? "for each item";
  if (execution?.kind === "loop") return execution.label ?? "loop";
  if (step.status === "running" || step.status === "waiting" || step.status === "failed") return step.status;
  return undefined;
}

export function loopRangeLabel(children: LoopGraphChildNode[], childIndexById: Map<string, number>) {
  if (children.length === 0) return "Loop";
  const first = childLocalIndex(children[0]!, childIndexById.get(children[0]!.id));
  const last = childLocalIndex(children[children.length - 1]!, childIndexById.get(children[children.length - 1]!.id));
  return `Loop ${first}-${last}`;
}

export function childLocalIndex(child: LoopGraphChildNode, fallbackIndex?: number) {
  const numeric = child.id.match(/(?:^|[-_.])(\d+)(?:[-_.]|$)/)?.[1];
  if (numeric) return numeric.padStart(2, "0");
  if (typeof fallbackIndex === "number") return String(fallbackIndex).padStart(2, "0");
  return "";
}

export function formatStepIndex(step: WorkflowRunStepView) {
  if (step.boundary === "trigger") return "[start]";
  if (step.boundary === "end") return "[end]";
  return String(step.index).padStart(2, "0");
}

export function mermaidLabel(value: string) {
  return displayText(value)
    .replace(/[()[\]{}|]/g, " ")
    .replace(/\s*<br\s*\/?>\s*/gi, "<br/>")
    .replace(/\s+/g, " ")
    .trim();
}

export function displayText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function childStepKey(parentStepId: string, childStepId: string) {
  return `${parentStepId}::${childStepId}`;
}
