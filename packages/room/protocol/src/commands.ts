import { isJsonObject, isJsonValue, type JsonObject, type JsonValue } from "./json.js";
import type { WorkflowJsonRenderDocument } from "./json-render.js";

export type WorkflowViewCommandSource = {
  adapterId?: string;
  participantId?: string;
  surface?: "platform" | "react" | "tui" | "watson" | string;
};

export type WorkflowHookResumeCommand = {
  requestId?: string;
  runId: string;
  source?: WorkflowViewCommandSource;
  token: string;
  type: "workflow.hook.resume";
  value: JsonValue;
};

export type WorkflowQuestionAnswerCommand = {
  questionId: string;
  requestId?: string;
  runId: string;
  source?: WorkflowViewCommandSource;
  type: "workflow.question.answer";
  value: JsonValue;
};

export type WorkflowActionApplyCommand = {
  actionKey: string;
  input?: JsonValue;
  requestId?: string;
  runId: string;
  source?: WorkflowViewCommandSource;
  type: "workflow.action.apply";
};

export type WorkflowSessionPauseCommand = {
  reason?: string;
  requestId?: string;
  runId: string;
  source?: WorkflowViewCommandSource;
  type: "workflow.session.pause";
};

export type WorkflowCheckpointRerunCommand = {
  checkpointId: string;
  input?: JsonValue;
  requestId?: string;
  runId: string;
  source?: WorkflowViewCommandSource;
  state?: JsonObject;
  type: "workflow.checkpoint.rerun";
};

export type RoomMessageAppendCommand = {
  content: string;
  metadata?: JsonObject;
  requestId?: string;
  roomId: string;
  source?: WorkflowViewCommandSource;
  type: "room.appendMessage";
};

export type RoomDecisionRecordCommand = {
  content: JsonValue;
  messageId?: string;
  requestId?: string;
  roomId: string;
  source?: WorkflowViewCommandSource;
  title: string;
  type: "room.recordDecision";
};

export type RoomHandRaiseResolveCommand = {
  handRaiseId: string;
  requestId?: string;
  resolvedByMessageId?: string;
  roomId: string;
  source?: WorkflowViewCommandSource;
  status?: "dismissed" | "resolved";
  type: "room.resolveHand";
};

export type WorkflowViewCommand =
  | RoomDecisionRecordCommand
  | RoomHandRaiseResolveCommand
  | RoomMessageAppendCommand
  | WorkflowActionApplyCommand
  | WorkflowCheckpointRerunCommand
  | WorkflowHookResumeCommand
  | WorkflowSessionPauseCommand
  | WorkflowQuestionAnswerCommand;

export type WorkflowViewCommandResult = {
  accepted: boolean;
  command: WorkflowViewCommand;
  dispatch?: {
    mode: "linked-run-metadata" | "room" | "runtime" | "watson-trace";
    runtimeResumed?: boolean;
    status: "dispatched" | "recorded" | "rejected";
    targetId?: string;
  };
  error?: {
    code: string;
    message: string;
  };
};

export type WorkflowViewCommandDispatch = NonNullable<
  WorkflowViewCommandResult["dispatch"]
>;

export type WorkflowViewCommandDispatchMode = WorkflowViewCommandDispatch["mode"];

export type WorkflowViewCommandDispatchStatus =
  WorkflowViewCommandDispatch["status"];

export type WorkflowViewCommandResultError = NonNullable<
  WorkflowViewCommandResult["error"]
>;

export type CreateWorkflowViewCommandResultInput = {
  accepted?: boolean;
  command: WorkflowViewCommand;
  dispatch: {
    mode: WorkflowViewCommandDispatchMode;
    runtimeResumed?: boolean;
    status?: WorkflowViewCommandDispatchStatus;
    targetId?: string;
  };
  error?: WorkflowViewCommandResultError;
};

export type WorkflowViewCommandValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type WorkflowViewCommandValidation = {
  command?: WorkflowViewCommand;
  issues: WorkflowViewCommandValidationIssue[];
  ok: boolean;
};

export function validateWorkflowViewCommand(value: unknown): WorkflowViewCommandValidation {
  const issues: WorkflowViewCommandValidationIssue[] = [];
  if (!isJsonObject(value)) {
    return {
      issues: [{
        code: "command.invalid",
        message: "Workflow View command must be a JSON object.",
        path: "command",
      }],
      ok: false,
    };
  }

  const command = value as Record<string, unknown>;
  const type = stringField(command, "type", "command", issues);
  validateCommandSource(command.source, "command.source", issues);
  optionalStringField(command, "requestId", "command", issues);

  switch (type) {
    case "workflow.hook.resume":
      stringField(command, "runId", "command", issues);
      stringField(command, "token", "command", issues);
      jsonValueField(command, "value", "command", issues);
      break;
    case "workflow.question.answer":
      stringField(command, "runId", "command", issues);
      stringField(command, "questionId", "command", issues);
      jsonValueField(command, "value", "command", issues);
      break;
    case "workflow.action.apply":
      stringField(command, "runId", "command", issues);
      stringField(command, "actionKey", "command", issues);
      optionalJsonValueField(command, "input", "command", issues);
      break;
    case "workflow.session.pause":
      stringField(command, "runId", "command", issues);
      optionalStringField(command, "reason", "command", issues);
      break;
    case "workflow.checkpoint.rerun":
      stringField(command, "runId", "command", issues);
      stringField(command, "checkpointId", "command", issues);
      optionalJsonValueField(command, "input", "command", issues);
      optionalJsonObjectField(command, "state", "command", issues);
      break;
    case "room.appendMessage":
      stringField(command, "roomId", "command", issues);
      stringField(command, "content", "command", issues);
      optionalJsonObjectField(command, "metadata", "command", issues);
      break;
    case "room.recordDecision":
      stringField(command, "roomId", "command", issues);
      stringField(command, "title", "command", issues);
      jsonValueField(command, "content", "command", issues);
      optionalStringField(command, "messageId", "command", issues);
      break;
    case "room.resolveHand":
      stringField(command, "roomId", "command", issues);
      stringField(command, "handRaiseId", "command", issues);
      optionalStringField(command, "resolvedByMessageId", "command", issues);
      if (
        command.status !== undefined &&
        command.status !== "dismissed" &&
        command.status !== "resolved"
      ) {
        addCommandIssue(issues, "command.status.invalid", "Room hand raise status must be resolved or dismissed.", "command.status");
      }
      break;
    default:
      if (typeof type === "string") {
        addCommandIssue(issues, "command.type.unsupported", `Unsupported workflow view command type: ${type}.`, "command.type");
      }
  }

  return {
    ...(issues.length === 0 ? { command: value as WorkflowViewCommand } : {}),
    issues,
    ok: issues.length === 0,
  };
}

export function isWorkflowViewCommand(value: unknown): value is WorkflowViewCommand {
  return validateWorkflowViewCommand(value).ok;
}

export function parseWorkflowViewCommand(value: unknown): WorkflowViewCommand {
  const result = validateWorkflowViewCommand(value);
  if (result.command) return result.command;
  throw new Error(result.issues.map((issue) => issue.message).join("\n"));
}

export function workflowViewCommandDispatchDescription(
  result: WorkflowViewCommandResult,
): string {
  const dispatch = result.dispatch;
  if (!dispatch) return "";
  return `${workflowViewCommandDispatchModeLabel(dispatch.mode)} · ${dispatch.status} · ${dispatch.runtimeResumed ? "runtime resumed" : "runtime not resumed"}`;
}

export function workflowViewCommandDispatchModeLabel(
  mode: NonNullable<WorkflowViewCommandResult["dispatch"]>["mode"],
): string {
  if (mode === "linked-run-metadata") return "linked-run metadata";
  if (mode === "watson-trace") return "Watson trace";
  return mode;
}

export function workflowViewCommandTargetId(command: WorkflowViewCommand): string {
  if ("runId" in command) return command.runId;
  if ("roomId" in command) return command.roomId;
  const unreachable: never = command;
  throw new Error(`Unsupported workflow view command target: ${JSON.stringify(unreachable)}.`);
}

export function createWorkflowViewCommandResult(
  input: CreateWorkflowViewCommandResultInput,
): WorkflowViewCommandResult {
  const accepted = input.accepted ?? true;
  const defaults = workflowViewCommandDispatchDefaults(input.dispatch.mode);
  return {
    accepted,
    command: input.command,
    dispatch: {
      mode: input.dispatch.mode,
      runtimeResumed: input.dispatch.runtimeResumed ?? (
        accepted ? defaults.runtimeResumed : false
      ),
      status: input.dispatch.status ?? (
        accepted ? defaults.status : "rejected"
      ),
      targetId: input.dispatch.targetId ?? workflowViewCommandTargetId(input.command),
    },
    ...(input.error ? { error: input.error } : {}),
  };
}

export function workflowViewCommandResultKey(result: WorkflowViewCommandResult): string {
  const command = result.command;
  const targetId = "runId" in command
    ? command.runId
    : "roomId" in command
      ? command.roomId
      : result.dispatch?.targetId ?? "session";
  const commandId = command.requestId ??
    ("token" in command
      ? command.token
      : "actionKey" in command
        ? command.actionKey
        : "checkpointId" in command
          ? command.checkpointId
          : "questionId" in command
            ? command.questionId
            : targetId);
  return `${command.type}:${targetId}:${commandId}`;
}

function workflowViewCommandDispatchDefaults(
  mode: WorkflowViewCommandDispatchMode,
): Pick<WorkflowViewCommandDispatch, "runtimeResumed" | "status"> {
  if (mode === "runtime") {
    return {
      runtimeResumed: true,
      status: "dispatched",
    };
  }
  if (mode === "room") {
    return {
      runtimeResumed: false,
      status: "dispatched",
    };
  }
  return {
    runtimeResumed: false,
    status: "recorded",
  };
}

export function workflowViewCommandResultToJsonRenderDocument(
  result: WorkflowViewCommandResult,
): WorkflowJsonRenderDocument {
  const dispatch = result.dispatch;
  return {
    component: "CommandStatus",
    props: {
      accepted: result.accepted,
      commandType: result.command.type,
      ...(dispatch?.mode ? { dispatchMode: workflowViewCommandDispatchModeLabel(dispatch.mode) } : {}),
      ...(result.error?.message ? { errorMessage: result.error.message } : {}),
      ...(dispatch?.runtimeResumed !== undefined ? { runtimeResumed: dispatch.runtimeResumed } : {}),
      runtimeLabel: dispatch
        ? dispatch.runtimeResumed
          ? "runtime resumed"
          : "runtime not resumed"
        : "runtime not dispatched",
      status: result.accepted ? "accepted" : "rejected",
      ...(dispatch?.status ? { dispatchStatus: dispatch.status } : {}),
      ...(dispatch?.targetId ? { targetId: dispatch.targetId } : {}),
    },
  };
}

function stringField(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: WorkflowViewCommandValidationIssue[],
) {
  const value = object[key];
  if (typeof value === "string" && value.trim()) return value;
  addCommandIssue(issues, `command.${key}.missing`, `Workflow View command field ${key} must be a non-empty string.`, `${path}.${key}`);
  return undefined;
}

function optionalStringField(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: WorkflowViewCommandValidationIssue[],
) {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  addCommandIssue(issues, `command.${key}.invalid`, `Workflow View command field ${key} must be a string.`, `${path}.${key}`);
  return undefined;
}

function jsonValueField(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: WorkflowViewCommandValidationIssue[],
) {
  const value = object[key];
  if (isJsonValue(value)) return value;
  addCommandIssue(issues, `command.${key}.invalid`, `Workflow View command field ${key} must be JSON-serializable.`, `${path}.${key}`);
  return undefined;
}

function optionalJsonValueField(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: WorkflowViewCommandValidationIssue[],
) {
  if (!(key in object)) return undefined;
  return jsonValueField(object, key, path, issues);
}

function optionalJsonObjectField(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: WorkflowViewCommandValidationIssue[],
) {
  const value = object[key];
  if (value === undefined) return undefined;
  if (isJsonObject(value)) return value;
  addCommandIssue(issues, `command.${key}.invalid`, `Workflow View command field ${key} must be a JSON object.`, `${path}.${key}`);
  return undefined;
}

function validateCommandSource(
  value: unknown,
  path: string,
  issues: WorkflowViewCommandValidationIssue[],
) {
  if (value === undefined) return;
  if (!isJsonObject(value)) {
    addCommandIssue(issues, "command.source.invalid", "Workflow View command source must be a JSON object.", path);
    return;
  }
  for (const key of ["adapterId", "participantId", "surface"]) {
    const field = value[key];
    if (field !== undefined && typeof field !== "string") {
      addCommandIssue(issues, `command.source.${key}.invalid`, `Workflow View command source ${key} must be a string.`, `${path}.${key}`);
    }
  }
}

function addCommandIssue(
  issues: WorkflowViewCommandValidationIssue[],
  code: string,
  message: string,
  path: string,
) {
  issues.push({ code, message, path });
}
