import { type WorkflowApp, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { type TuiWorkspaceFrame } from "./types.js";
import { workflowDesignNodes } from "./workflow-design.js";
import * as path from "node:path";

export function workspaceStatusColor(status: TuiWorkspaceFrame["status"]) {
  if (status === "published") return THEME.success;
  if (status === "valid") return THEME.info;
  return THEME.warning;
}

export function workflowCanvasGraph(
  workflow: WorkflowAppWorkflowDescriptor,
  frame: TuiWorkspaceFrame | undefined,
  fallbackGraph: ReturnType<WorkflowApp["graph"]>,
) {
  if (workflowUsesWorkspaceCanvas(workflow, frame) && frame?.proposal?.compiledGraph) return frame.proposal.compiledGraph;
  if (workflowUsesWorkspaceCanvas(workflow, frame) && frame?.compiledGraph) return frame.compiledGraph;
  return fallbackGraph;
}

export function workflowUsesWorkspaceCanvas(
  workflow: WorkflowAppWorkflowDescriptor,
  frame?: TuiWorkspaceFrame,
) {
  if (!frame) return false;
  if (!frame.compiledGraph && !frame.proposal?.compiledGraph) return false;
  if (frame.patches.length === 0 && !frame.proposal?.patches.length) return false;
  return workflow.id.includes("author") || frame.workspaceId.includes("author");
}

export function workspaceIssueSummary(frame: TuiWorkspaceFrame, width: number) {
  const error = frame.validation.issues.find((issue) => issue.severity === "error");
  if (!error) return "no blocking issues";
  return truncate(`${error.code}: ${error.message}`, width);
}

export function workspaceGraphSummary(frame: TuiWorkspaceFrame) {
  if (frame.proposal?.compiledGraph) {
    return `proposal graph: ${workflowDesignNodes(frame.proposal.compiledGraph).length} nodes`;
  }
  if (!frame.compiledGraph) return "workspace graph: draft";
  return `workspace graph: ${workflowDesignNodes(frame.compiledGraph).length} nodes`;
}

export function workspaceGraphCompact(frame: TuiWorkspaceFrame) {
  if (frame.proposal?.compiledGraph) return `${workflowDesignNodes(frame.proposal.compiledGraph).length} proposed nodes`;
  if (!frame.compiledGraph) return "draft graph";
  return `${workflowDesignNodes(frame.compiledGraph).length} nodes`;
}

export function workspacePatchCount(frame: TuiWorkspaceFrame) {
  if (frame.proposal?.patches.length) {
    return `${frame.proposal.patches.length} proposed patch${frame.proposal.patches.length === 1 ? "" : "es"}`;
  }
  return `${frame.patches.length} patch${frame.patches.length === 1 ? "" : "es"}`;
}

export function workspaceLatestPatchSummary(frame: TuiWorkspaceFrame, width: number) {
  const latest = frame.patches.at(-1);
  if (!latest) return "latest patch: none";
  return truncate(`latest patch: ${latest.patch.op} ${latest.patch.path || "/"}`, width);
}

export function workspaceLatestPatchCompact(frame: TuiWorkspaceFrame) {
  const proposed = frame.proposal?.patches.at(-1);
  if (proposed) return `proposed: ${proposed.patch.op} ${proposed.patch.path || "/"}`;
  const latest = frame.patches.at(-1);
  if (!latest) return "latest: none";
  return `${latest.patch.op} ${latest.patch.path || "/"}`;
}

export function workspaceLatestPatchValue(frame: TuiWorkspaceFrame) {
  const proposed = frame.proposal?.patches.at(-1);
  if (proposed) return `proposed ${proposed.patch.op} ${proposed.patch.path || "/"}`;
  const latest = frame.patches.at(-1);
  if (!latest) return "none";
  return `${latest.patch.op} ${latest.patch.path || "/"}`;
}

export function workspaceIssueValue(frame: TuiWorkspaceFrame) {
  const validation = frame.proposal?.validation ?? frame.validation;
  const errorCount = validation.issues.filter((issue) => issue.severity === "error").length;
  return errorCount === 0 ? "none" : `${errorCount} blocking`;
}

export function workspaceLatestTestValue(frame: TuiWorkspaceFrame) {
  if (!frame.latestTest) return "not run";
  return `${frame.latestTest.status} · ${formatWorkspaceTestDuration(frame.latestTest.durationMs)}`;
}

export function workspaceLatestTestColor(frame: TuiWorkspaceFrame) {
  if (!frame.latestTest) return THEME.muted;
  if (frame.latestTest.status === "failed") return THEME.error;
  if (frame.latestTest.status === "completed") return THEME.success;
  return THEME.warning;
}

export function formatWorkspaceTestDuration(value: number) {
  const abs = Math.max(0, value);
  if (abs < 1000) return `${Math.round(abs)}ms`;
  if (abs < 10_000) return `${(abs / 1000).toFixed(2)}s`;
  if (abs < 60_000) return `${(abs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}
