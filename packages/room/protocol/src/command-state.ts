import {
  isWorkflowViewCommand,
  type WorkflowViewCommand,
  type WorkflowViewCommandDispatch,
  type WorkflowViewCommandResult,
} from "./commands.js";
import {
  assertJsonValue,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./json.js";

const WORKFLOW_UI_COMMAND_TYPES = [
  "room.recordDecision",
  "room.resolveHand",
  "room.appendMessage",
  "workflow.action.apply",
  "workflow.checkpoint.rerun",
  "workflow.hook.resume",
  "workflow.question.answer",
  "workflow.session.pause",
] as const satisfies readonly WorkflowViewCommand["type"][];

const WORKFLOW_UI_COMMAND_DISPATCH_MODES = [
  "linked-run-metadata",
  "room",
  "runtime",
  "watson-trace",
] as const satisfies readonly WorkflowViewCommandDispatch["mode"][];

const WORKFLOW_UI_COMMAND_DISPATCH_STATUSES = [
  "dispatched",
  "recorded",
  "rejected",
] as const satisfies readonly WorkflowViewCommandDispatch["status"][];

export type WorkflowViewCommandRecord = {
  recordedAt: string;
  requestId?: string;
  type: WorkflowViewCommand["type"];
};

export type WorkflowViewCommandState = {
  commandResults: WorkflowViewCommandResult[];
  commands: WorkflowViewCommandRecord[];
  hookResponses: JsonObject;
  lastCommand?: WorkflowViewCommand;
  submittedHookTokens: string[];
};

export type ApplyWorkflowViewCommandResultOptions = {
  recordedAt?: string;
};

export function workflowViewCommandStateFromWorkflowView(
  value: unknown,
): WorkflowViewCommandState {
  const workflowView = jsonObject(value);
  const commandResults = workflowViewCommandResultsFromValue(
    workflowView.commandResults,
  );
  const hookResponses = {
    ...jsonObject(workflowView.hookResponses),
    ...workflowViewHookResponsesFromCommandResults(commandResults),
  };
  const lastCommand = isWorkflowViewCommand(workflowView.lastCommand)
    ? workflowView.lastCommand
    : commandResults.at(-1)?.command;

  return {
    commandResults,
    commands: workflowViewCommandRecordsFromValue(workflowView.commands),
    hookResponses,
    ...(lastCommand ? { lastCommand } : {}),
    submittedHookTokens: uniqueStrings([
      ...stringArray(workflowView.submittedHookTokens),
      ...workflowViewSubmittedHookTokensFromCommandResults(commandResults),
    ]),
  };
}

export function applyWorkflowViewCommandResultToMetadata(
  metadata: unknown,
  result: WorkflowViewCommandResult,
  options: ApplyWorkflowViewCommandResultOptions = {},
): JsonObject {
  const root = jsonObject(metadata);
  return {
    ...root,
    workflowView: applyWorkflowViewCommandResultToWorkflowView(
      root.workflowView,
      result,
      options,
    ),
  };
}

export function applyWorkflowViewCommandResultToWorkflowView(
  workflowViewValue: unknown,
  result: WorkflowViewCommandResult,
  options: ApplyWorkflowViewCommandResultOptions = {},
): JsonObject {
  const workflowView = jsonObject(workflowViewValue);
  const state = workflowViewCommandStateFromWorkflowView(workflowView);
  const commandResults = [...state.commandResults, result];
  const hookResponses = {
    ...state.hookResponses,
    ...workflowViewHookResponsesFromCommandResults([result]),
  };
  const submittedHookTokens = uniqueStrings([
    ...state.submittedHookTokens,
    ...workflowViewSubmittedHookTokensFromCommandResults([result]),
  ]);

  return {
    ...workflowView,
    commands: [
      ...state.commands,
      workflowViewCommandRecordForCommand(
        result.command,
        options.recordedAt ?? new Date().toISOString(),
      ),
    ].map((record) => jsonValue(record, "Workflow View command record")),
    commandResults: commandResults.map((commandResult) =>
      jsonValue(commandResult, "Workflow View command result")
    ),
    ...(Object.keys(hookResponses).length ? { hookResponses } : {}),
    lastCommand: jsonValue(result.command, "Workflow View command"),
    ...(submittedHookTokens.length ? { submittedHookTokens } : {}),
  };
}

export function workflowViewCommandResultsFromValue(
  value: unknown,
): WorkflowViewCommandResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isWorkflowViewCommandResult);
}

export function workflowViewSubmittedHookTokensFromCommandResults(
  commandResults: readonly WorkflowViewCommandResult[],
): string[] {
  return uniqueStrings(commandResults.flatMap((result) => {
    if (!result.accepted || result.command.type !== "workflow.hook.resume") {
      return [];
    }
    return [result.command.token];
  }));
}

export function workflowViewHookResponsesFromCommandResults(
  commandResults: readonly WorkflowViewCommandResult[],
): JsonObject {
  const responses: JsonObject = {};
  for (const result of commandResults) {
    if (!result.accepted || result.command.type !== "workflow.hook.resume") {
      continue;
    }
    responses[result.command.token] = result.command.value;
  }
  return responses;
}

export function workflowViewCommandRecordForCommand(
  command: WorkflowViewCommand,
  recordedAt: string,
): WorkflowViewCommandRecord {
  return {
    recordedAt,
    ...(command.requestId ? { requestId: command.requestId } : {}),
    type: command.type,
  };
}

export function isWorkflowViewCommandResult(
  value: unknown,
): value is WorkflowViewCommandResult {
  if (!isJsonObject(value)) return false;
  if (typeof value.accepted !== "boolean") return false;
  if (!isWorkflowViewCommand(value.command)) return false;
  if (
    value.dispatch !== undefined &&
    !isWorkflowViewCommandDispatch(value.dispatch)
  ) {
    return false;
  }
  if (value.error !== undefined && !isWorkflowViewCommandError(value.error)) {
    return false;
  }
  return true;
}

function workflowViewCommandRecordsFromValue(
  value: unknown,
): WorkflowViewCommandRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isWorkflowViewCommandRecord);
}

function isWorkflowViewCommandRecord(
  value: unknown,
): value is WorkflowViewCommandRecord {
  if (!isJsonObject(value)) return false;
  if (typeof value.recordedAt !== "string") return false;
  if (!isWorkflowViewCommandType(value.type)) return false;
  return value.requestId === undefined || typeof value.requestId === "string";
}

function isWorkflowViewCommandType(
  value: unknown,
): value is WorkflowViewCommand["type"] {
  return WORKFLOW_UI_COMMAND_TYPES.includes(
    value as WorkflowViewCommand["type"],
  );
}

function isWorkflowViewCommandDispatch(
  value: unknown,
): value is WorkflowViewCommandDispatch {
  if (!isJsonObject(value)) return false;
  if (
    !WORKFLOW_UI_COMMAND_DISPATCH_MODES.includes(
      value.mode as WorkflowViewCommandDispatch["mode"],
    )
  ) {
    return false;
  }
  if (
    !WORKFLOW_UI_COMMAND_DISPATCH_STATUSES.includes(
      value.status as WorkflowViewCommandDispatch["status"],
    )
  ) {
    return false;
  }
  if (
    value.runtimeResumed !== undefined &&
    typeof value.runtimeResumed !== "boolean"
  ) {
    return false;
  }
  return value.targetId === undefined || typeof value.targetId === "string";
}

function isWorkflowViewCommandError(value: unknown) {
  if (!isJsonObject(value)) return false;
  return typeof value.code === "string" && typeof value.message === "string";
}

function jsonObject(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function jsonValue(value: unknown, label: string): JsonValue {
  assertJsonValue(value, label);
  return value;
}
