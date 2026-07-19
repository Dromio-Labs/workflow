import { type WorkflowRunSemanticRow } from "../workflow-run-store.js";
import { providerModelSummary } from "./active-run-session.js";
import { activityDetails, activityTypeLabel, flattenActivityChildren } from "./activity-table.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";

export function activityTimelineGlyph(row: WorkflowRunSemanticRow) {
  if (activityRowNeedsAnswer(row)) return "!";
  if (activityRowIsCompletedModel(row)) return "✓";
  if (activityRowIsWorker(row)) return "●";
  if (row.status === "ok") return "✓";
  if (row.status === "running") return "●";
  if (row.status === "warning") return "!";
  if (row.status === "error") return "×";
  if (activityRowIsModelOrWorker(row)) return "◇";
  return "·";
}

export function activityTimelineColor(row: WorkflowRunSemanticRow) {
  if (activityRowNeedsAnswer(row)) return THEME.warning;
  if (activityRowIsCompletedModel(row)) return THEME.success;
  if (activityRowIsWorker(row)) return THEME.info;
  if (row.status === "ok") return THEME.success;
  if (row.status === "running") return THEME.info;
  if (row.status === "warning") return THEME.warning;
  if (row.status === "error") return THEME.error;
  if (activityRowIsModelOrWorker(row)) return THEME.info;
  return THEME.muted;
}

export function activityTimelineLabel(row: WorkflowRunSemanticRow) {
  if (activityRowNeedsAnswer(row)) return "answer required";
  const key = `${row.phaseId} ${row.phaseTitle}`.toLowerCase();
  if (key.includes("model")) return activityRowIsCompletedModel(row) ? "model completed" : "model";
  if (activityRowIsWorker(row)) return "worker activity";
  return activityTypeLabel(row);
}

export function activityTimelineDetailLines(row: WorkflowRunSemanticRow, width: number) {
  if (activityRowNeedsAnswer(row)) return [];
  const lines = [
    { primary: true, text: activityDetails(row) },
    ...(activityTimelineModelLines(row).map((text) => ({ primary: false, text }))),
    ...flattenActivityChildren(row.children ?? []).slice(0, 2).map((text) => ({ primary: false, text })),
  ];
  return lines
    .map((line) => ({ ...line, text: truncate(line.text, width) }))
    .filter((line) => line.text.trim().length > 0);
}

export function activityTimelineModelLines(row: WorkflowRunSemanticRow) {
  const line = providerModelSummary(row.provider, row.model);
  return line ? [line] : [];
}

export function activityRowNeedsAnswer(row: WorkflowRunSemanticRow) {
  if (row.eventType === "question.answered") return false;
  if (row.eventType === "question.resolution.accepted" || row.eventType === "question.resolution.rejected") return false;
  const key = `${row.phaseId} ${row.phaseTitle} ${row.text}`.toLowerCase();
  return key.includes("question") || key.includes("waiting") || key.includes("answer");
}

export function activityRowIsCompletedModel(row: WorkflowRunSemanticRow) {
  const key = `${row.phaseId} ${row.phaseTitle} ${row.text}`.toLowerCase();
  return key.includes("model") && (row.status === "ok" || key.includes("output") || key.includes("chars"));
}

export function activityRowIsWorker(row: WorkflowRunSemanticRow) {
  const key = `${row.phaseId} ${row.phaseTitle}`.toLowerCase();
  return key.includes("worker");
}

export function activityRowIsModelOrWorker(row: WorkflowRunSemanticRow) {
  const key = `${row.phaseId} ${row.phaseTitle}`.toLowerCase();
  return key.includes("model") || key.includes("worker") || key.includes("operation");
}
