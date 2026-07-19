import type {
  WorkflowHookResumeCommand,
  WorkflowViewCommandSource,
} from "./commands.js";
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./json.js";
import {
  normalizeWorkflowJsonRenderDocument,
  type WorkflowJsonRenderDocument,
} from "./json-render.js";

export type WorkflowHookRenderHint =
  | {
      kind: "approval";
      approveLabel?: string;
      rejectLabel?: string;
      schema?: JsonObject;
    }
  | {
      kind: "form";
      schema: JsonObject;
      submitLabel?: string;
    }
  | {
      catalogId?: string;
      document: JsonObject;
      kind: "json-render";
      state?: JsonValue;
    }
  | {
      adapter: string;
      kind: "custom";
      props?: JsonObject;
    };

export type WorkflowHookRequest = {
  correlationId?: string;
  expiresAt?: string;
  id: string;
  input: JsonValue;
  kind?: string;
  render?: WorkflowHookRenderHint;
  runId?: string;
  schema?: JsonObject;
  stepId: string;
  title?: string;
  token: string;
};

export type WorkflowHookResumeValue = JsonValue;

export type WorkflowHookJsonRenderDocumentOptions = {
  fallbackTitle?: string;
};

export type CreateWorkflowHookResumeCommandInput = {
  requestId?: string;
  runId?: string;
  source?: WorkflowViewCommandSource;
  value: WorkflowHookResumeValue;
};

export function workflowHookToJsonRenderDocument(
  hook: WorkflowHookRequest,
  options: WorkflowHookJsonRenderDocumentOptions = {},
): WorkflowJsonRenderDocument {
  if (hook.render?.kind === "json-render") {
    return normalizeWorkflowJsonRenderDocument(hook.render.document, {
      fallbackTitle: options.fallbackTitle ?? hook.title ?? hook.id,
    });
  }

  if (hook.render?.kind === "approval") {
    return approvalCardDocumentForHook(hook);
  }

  return {
    component: "JsonInspector",
    props: {
      title: options.fallbackTitle ?? hook.title ?? hook.id,
      value: hook.input,
    },
  };
}

export function createWorkflowHookResumeCommand(
  hook: WorkflowHookRequest,
  input: CreateWorkflowHookResumeCommandInput,
): WorkflowHookResumeCommand | undefined {
  const runId = input.runId ?? hook.runId;
  if (!runId || !hook.token) return undefined;
  return {
    ...(input.requestId ? { requestId: input.requestId } : {}),
    runId,
    ...(input.source ? { source: input.source } : {}),
    token: hook.token,
    type: "workflow.hook.resume",
    value: input.value,
  };
}

function approvalCardDocumentForHook(hook: WorkflowHookRequest): WorkflowJsonRenderDocument {
  const input = isJsonObject(hook.input) ? hook.input : {};
  const render = hook.render?.kind === "approval" ? hook.render : undefined;
  const props: JsonObject = {
    approveLabel: render?.approveLabel ?? "Approve",
    rejectLabel: render?.rejectLabel ?? "Reject",
    subtitle: `${hook.stepId} · approval`,
    title: hook.title ?? "Approval required",
  };
  const imageCount = numberValue(input.imageCount);
  const question = stringValue(input.question) ?? stringValue(input.message);
  if (imageCount !== undefined) props.imageCount = imageCount;
  if (question) props.question = question;
  return {
    component: "ApprovalCard",
    props,
  };
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
