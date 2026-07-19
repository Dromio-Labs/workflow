import { validateWorkflowViewCommand } from "./commands.js";
import { isJsonObject } from "./json.js";
import { addIssue } from "./validation-issue.js";
import type { WorkflowViewValidationIssue, WorkflowViewSnapshot } from "./snapshot.js";

const commandResultDispatchModes = new Set([
  "linked-run-metadata",
  "room",
  "runtime",
  "watson-trace",
]);
const commandResultDispatchStatuses = new Set([
  "dispatched",
  "recorded",
  "rejected",
]);

export function validateCommandResults(
  snapshot: WorkflowViewSnapshot,
  issues: WorkflowViewValidationIssue[],
) {
  const commandResults = (snapshot as { commandResults?: unknown }).commandResults;
  if (commandResults === undefined) return;
  if (!Array.isArray(commandResults)) {
    addIssue(issues, "command_result.list_invalid", "Command results must be an array.", "commandResults");
    return;
  }
  for (const [index, result] of commandResults.entries()) {
    const resultPath = `commandResults.${index}`;
    if (!isJsonObject(result)) {
      addIssue(issues, "command_result.invalid", "Command result must be a JSON object.", resultPath);
      continue;
    }
    if (typeof result.accepted !== "boolean") {
      addIssue(issues, "command_result.accepted_invalid", "Command result accepted must be a boolean.", `${resultPath}.accepted`);
    }
    validateCommandResultCommand(result.command, resultPath, issues);
    validateCommandResultDispatch(result.dispatch, resultPath, issues);
    validateCommandResultError(result.error, resultPath, issues);
  }
}

function validateCommandResultCommand(
  command: unknown,
  resultPath: string,
  issues: WorkflowViewValidationIssue[],
) {
  const validation = validateWorkflowViewCommand(command);
  for (const issue of validation.issues) {
    const suffix = issue.path === "command"
      ? "command"
      : issue.path.startsWith("command.")
        ? issue.path.slice("command.".length)
        : issue.path;
    addIssue(
      issues,
      `command_result.${issue.code}`,
      issue.message,
      suffix === "command"
        ? `${resultPath}.command`
        : `${resultPath}.command.${suffix}`,
    );
  }
}

function validateCommandResultDispatch(
  dispatch: unknown,
  resultPath: string,
  issues: WorkflowViewValidationIssue[],
) {
  if (dispatch === undefined) return;
  if (!isJsonObject(dispatch)) {
    addIssue(issues, "command_result.dispatch_invalid", "Command result dispatch must be a JSON object.", `${resultPath}.dispatch`);
    return;
  }
  if (
    typeof dispatch.mode !== "string" ||
    !commandResultDispatchModes.has(dispatch.mode)
  ) {
    addIssue(issues, "command_result.dispatch.mode_invalid", "Command result dispatch mode is invalid.", `${resultPath}.dispatch.mode`);
  }
  if (
    typeof dispatch.status !== "string" ||
    !commandResultDispatchStatuses.has(dispatch.status)
  ) {
    addIssue(issues, "command_result.dispatch.status_invalid", "Command result dispatch status is invalid.", `${resultPath}.dispatch.status`);
  }
  if (
    dispatch.runtimeResumed !== undefined &&
    typeof dispatch.runtimeResumed !== "boolean"
  ) {
    addIssue(issues, "command_result.dispatch.runtime_resumed_invalid", "Command result runtimeResumed must be a boolean.", `${resultPath}.dispatch.runtimeResumed`);
  }
  if (
    dispatch.targetId !== undefined &&
    typeof dispatch.targetId !== "string"
  ) {
    addIssue(issues, "command_result.dispatch.target_id_invalid", "Command result targetId must be a string.", `${resultPath}.dispatch.targetId`);
  }
}

function validateCommandResultError(
  error: unknown,
  resultPath: string,
  issues: WorkflowViewValidationIssue[],
) {
  if (error === undefined) return;
  if (!isJsonObject(error)) {
    addIssue(issues, "command_result.error_invalid", "Command result error must be a JSON object.", `${resultPath}.error`);
    return;
  }
  if (typeof error.code !== "string" || !error.code.trim()) {
    addIssue(issues, "command_result.error.code_invalid", "Command result error code must be a non-empty string.", `${resultPath}.error.code`);
  }
  if (typeof error.message !== "string" || !error.message.trim()) {
    addIssue(issues, "command_result.error.message_invalid", "Command result error message must be a non-empty string.", `${resultPath}.error.message`);
  }
}
