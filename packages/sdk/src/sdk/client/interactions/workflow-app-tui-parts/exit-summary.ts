import type { WorkflowApp, WorkflowAppRun } from "../workflow-app.js";
import { truncate } from "./string-format.js";
import { formatDromioWordmark, shouldUseAnsiColor } from "./style.js";

export function formatWorkflowTuiExitSummary(
  app: WorkflowApp,
  run: WorkflowAppRun | undefined,
) {
  const wordmark = formatDromioWordmark({ color: shouldUseAnsiColor() });
  if (!run) return `\n${wordmark}\n`;
  const descriptor = run
    ? app.listWorkflows().find((workflow) => workflow.id === run.workflowId)
    : undefined;
  const title = run?.input.trim()
    ? truncate(run.input.trim().replace(/\s+/g, " "), 60)
    : descriptor?.title ?? app.title;
  return `\n${wordmark}\n\n  Last run  ${title}\n  Run ID    ${run.runId}\n`;
}
