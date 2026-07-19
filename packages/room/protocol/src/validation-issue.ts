import type { WorkflowViewValidationIssue } from "./snapshot.js";

export function addIssue(
  issues: WorkflowViewValidationIssue[],
  code: string,
  message: string,
  path?: string,
  severity: WorkflowViewValidationIssue["severity"] = "error",
) {
  issues.push({
    code,
    message,
    path,
    severity,
  });
}
