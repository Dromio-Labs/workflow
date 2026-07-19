import {
  workflowViewCommandStateFromWorkflowView,
  workflowViewCommandResultsFromValue,
  type WorkflowViewCommandState,
} from "./command-state.js";
import type { WorkflowViewCommandResult } from "./commands.js";
import type { WorkflowHookRenderHint, WorkflowHookRequest } from "./hooks.js";
import {
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json.js";
import {
  normalizeWorkflowResultPresentation,
  type NormalizeWorkflowResultPresentationOptions,
  type WorkflowResultPresentation,
} from "./result.js";
import type {
  WorkflowRoomHandRaise,
  WorkflowRoomRunLink,
  WorkflowRoomSnapshot,
} from "./room.js";
import type { WorkflowViewSnapshot } from "./snapshot.js";

export type WorkflowViewLiveState = {
  commandResults: WorkflowViewCommandResult[];
  pendingHooks: WorkflowHookRequest[];
  result?: WorkflowResultPresentation;
};

export type WorkflowViewLiveStateOptions = {
  resultFallbackKind?: NormalizeWorkflowResultPresentationOptions["fallbackKind"];
  resultTitle?: string;
};

export type WorkflowHookRequestsFromRoomHandRaisesOptions = {
  fallbackRunId?: string;
  fallbackStepId?: string;
  fallbackWorkflowId?: string;
  idPrefix?: string;
  tokenPrefix?: string;
};

export function workflowViewCommandResultsFromRoomSnapshot(
  room: WorkflowRoomSnapshot | undefined,
): WorkflowViewCommandResult[] {
  if (!room) return [];
  const roomResults = workflowViewCommandResultsFromValue(
    room.metadata.workflowCommandResults,
  );
  return roomResults.length
    ? roomResults
    : workflowViewCommandResultsFromRunLinks(room.workflowRuns);
}

export function workflowViewCommandResultsFromRunLinks(
  runs: readonly WorkflowRoomRunLink[] | undefined,
): WorkflowViewCommandResult[] {
  return (runs ?? []).flatMap((run) =>
    workflowViewCommandResultsFromValue(commandResultsValue(run))
  );
}

export function workflowViewPendingHooksFromWorkflowView(
  workflowViewValue: unknown,
): WorkflowHookRequest[] {
  const workflowView = jsonObject(workflowViewValue);
  const commandState = workflowViewCommandStateFromWorkflowView(workflowView);
  return workflowViewPendingHooksFromParsedWorkflowView(workflowView, commandState);
}

export function workflowViewLiveStateFromWorkflowView(
  workflowViewValue: unknown,
  options: WorkflowViewLiveStateOptions = {},
): WorkflowViewLiveState {
  const workflowView = jsonObject(workflowViewValue);
  const commandState = workflowViewCommandStateFromWorkflowView(workflowView);
  const result = normalizeWorkflowResultPresentation(workflowView.result, {
    ...(options.resultFallbackKind ? { fallbackKind: options.resultFallbackKind } : {}),
    title: options.resultTitle ?? "Workflow result",
  });
  return {
    commandResults: commandState.commandResults,
    pendingHooks: workflowViewPendingHooksFromParsedWorkflowView(
      workflowView,
      commandState,
    ),
    ...(result ? { result } : {}),
  };
}

export function workflowViewSnapshotWithLiveState(
  snapshot: WorkflowViewSnapshot | undefined,
  liveState: WorkflowViewLiveState,
): WorkflowViewSnapshot | undefined {
  if (!snapshot) return undefined;
  const {
    commandResults: _commandResults,
    pendingHooks: _pendingHooks,
    result: _result,
    ...baseSnapshot
  } = snapshot;
  return {
    ...baseSnapshot,
    commandResults: liveState.commandResults,
    pendingHooks: liveState.pendingHooks,
    ...(liveState.result ? { result: liveState.result } : {}),
  };
}

export function workflowViewPendingHooksFromRunLinks(
  runs: readonly WorkflowRoomRunLink[] | undefined,
): WorkflowHookRequest[] {
  return (runs ?? []).flatMap((run) => {
    const workflowView = workflowViewValue(run);
    return workflowViewPendingHooksFromWorkflowView(workflowView);
  });
}

export function workflowViewPendingHooksFromRoomSnapshot(
  room: WorkflowRoomSnapshot | undefined,
): WorkflowHookRequest[] {
  return workflowViewPendingHooksFromRunLinks(room?.workflowRuns);
}

export function workflowHookRequestsFromRoomHandRaises(
  handRaises: readonly WorkflowRoomHandRaise[] | undefined,
  options: WorkflowHookRequestsFromRoomHandRaisesOptions = {},
): WorkflowHookRequest[] {
  return (handRaises ?? [])
    .filter((handRaise) => handRaise.status !== "resolved" && handRaise.status !== "dismissed")
    .map((handRaise) => {
      const metadata = handRaise.metadata ?? {};
      const stepId = stringValue(metadata.stepId) ??
        options.fallbackStepId ??
        options.fallbackWorkflowId ??
        "workflow";
      const runId = stringValue(metadata.runId) ?? options.fallbackRunId ?? "workflow-run";
      return {
        id: `${options.idPrefix ?? "room."}${handRaise.id}`,
        input: {
          priority: handRaise.priority || "normal",
          question: handRaise.question,
          reason: handRaise.reason || "",
        },
        kind: handRaise.reason === "approval" ? "approval" : "human_input",
        render: workflowHookRenderHintFromRoomHandRaise(handRaise),
        runId,
        stepId,
        title: handRaise.question || "Human input requested",
        token: `${options.tokenPrefix ?? "room:"}${handRaise.id}`,
      };
    });
}

export function workflowHookRequestsFromValue(
  value: unknown,
): WorkflowHookRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const hook = workflowHookRequestFromValue(item);
    return hook ? [hook] : [];
  });
}

function commandResultsValue(run: WorkflowRoomRunLink) {
  const workflowView = workflowViewValue(run);
  return isJsonObject(workflowView) ? workflowView.commandResults : undefined;
}

function workflowViewPendingHooksFromParsedWorkflowView(
  workflowView: JsonObject,
  commandState: WorkflowViewCommandState,
): WorkflowHookRequest[] {
  const submittedHookTokens = new Set(commandState.submittedHookTokens);
  return workflowHookRequestsFromValue(workflowView.pendingHooks)
    .filter((hook) => !submittedHookTokens.has(hook.token));
}

function workflowViewValue(run: WorkflowRoomRunLink) {
  return run.metadata?.workflowView;
}

function workflowHookRequestFromValue(value: unknown): WorkflowHookRequest | undefined {
  if (!isJsonObject(value)) return undefined;
  if (!(nonEmptyString(value.id) && nonEmptyString(value.stepId) && nonEmptyString(value.token))) {
    return undefined;
  }
  if (!isJsonValue(value.input)) return undefined;
  const render = workflowHookRenderHintFromValue(value.render);
  const schema = jsonObjectOrUndefined(value.schema);
  return {
    ...(stringValue(value.correlationId) ? { correlationId: stringValue(value.correlationId) } : {}),
    ...(stringValue(value.expiresAt) ? { expiresAt: stringValue(value.expiresAt) } : {}),
    id: value.id,
    input: value.input,
    ...(stringValue(value.kind) ? { kind: stringValue(value.kind) } : {}),
    ...(render ? { render } : {}),
    ...(stringValue(value.runId) ? { runId: stringValue(value.runId) } : {}),
    ...(schema ? { schema } : {}),
    stepId: value.stepId,
    ...(stringValue(value.title) ? { title: stringValue(value.title) } : {}),
    token: value.token,
  };
}

function workflowHookRenderHintFromValue(
  value: unknown,
): WorkflowHookRenderHint | undefined {
  if (!isJsonObject(value)) return undefined;
  if (value.kind === "approval") {
    return {
      ...(stringValue(value.approveLabel) ? { approveLabel: stringValue(value.approveLabel) } : {}),
      kind: "approval",
      ...(stringValue(value.rejectLabel) ? { rejectLabel: stringValue(value.rejectLabel) } : {}),
      ...(jsonObjectOrUndefined(value.schema) ? { schema: jsonObjectOrUndefined(value.schema) } : {}),
    };
  }
  if (value.kind === "form") {
    const schema = jsonObjectOrUndefined(value.schema);
    if (!schema) return undefined;
    return {
      kind: "form",
      schema,
      ...(stringValue(value.submitLabel) ? { submitLabel: stringValue(value.submitLabel) } : {}),
    };
  }
  if (value.kind === "json-render") {
    const document = jsonObjectOrUndefined(value.document);
    if (!document) return undefined;
    return {
      ...(stringValue(value.catalogId) ? { catalogId: stringValue(value.catalogId) } : {}),
      document,
      kind: "json-render",
      ...(isJsonValue(value.state) ? { state: value.state } : {}),
    };
  }
  if (value.kind === "custom") {
    if (!nonEmptyString(value.adapter)) return undefined;
    return {
      adapter: value.adapter,
      kind: "custom",
      ...(jsonObjectOrUndefined(value.props) ? { props: jsonObjectOrUndefined(value.props) } : {}),
    };
  }
  return undefined;
}

function workflowHookRenderHintFromRoomHandRaise(
  handRaise: WorkflowRoomHandRaise,
): WorkflowHookRenderHint {
  if (handRaise.reason === "approval") {
    return {
      approveLabel: "Approve",
      kind: "approval",
      rejectLabel: "Hold",
    };
  }
  return {
    kind: "form",
    schema: {
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
      type: "object",
    },
    submitLabel: "Send answer",
  };
}

function jsonObject(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function jsonObjectOrUndefined(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
