import type {
  EventRecord,
  LoopGraphBoundary,
  LoopGraphPort,
  Question,
} from "../../core/index.js";
import type {
  WorkflowRunActivityView,
  WorkflowRunModelView,
  WorkflowRunStepView,
} from "./workflow-run-projection.types.js";

export function boundaryStep(
  boundary: LoopGraphBoundary | undefined,
  kind: "end" | "trigger",
  index: number,
): WorkflowRunStepView {
  const fallback = kind === "trigger"
    ? {
      description: "Input received and workflow run created.",
      id: "$trigger",
      label: "Trigger",
    }
    : {
      description: "Workflow terminal state.",
      id: "$end",
      label: "End",
    };
  return {
    boundary: kind,
    description: boundary?.description ?? fallback.description,
    id: boundary?.id ?? fallback.id,
    index,
    label: boundary?.label ?? fallback.label,
    status: "pending",
    ...(boundary?.type ? { triggerType: boundary.type } : {}),
  };
}

export function runtimeInputForStep(
  ports: LoopGraphPort[] | undefined,
  state: Record<string, unknown>,
  workflowInput: unknown,
) {
  const entries = ports ?? [];
  if (entries.length === 0) return undefined;
  const input: Record<string, unknown> = {};
  for (const port of entries) {
    const key = port.key;
    const source = key in state
      ? state
      : isRecord(workflowInput) && key in workflowInput
      ? workflowInput
      : undefined;
    input[key] = source ? source[key] : entries.length === 1 ? workflowInput : undefined;
  }
  return input;
}

export function mergeRuntimeOutput(
  state: Record<string, unknown>,
  stepId: string,
  output: unknown,
) {
  state[stepId] = output;
  if (!isRecord(output)) return;
  Object.assign(state, output);
}

export function waitingStateFromEvent(event: EventRecord) {
  const detail = event.detail;
  if (!isRecord(detail)) return undefined;
  const state = detail.state;
  return isRecord(state) ? state : undefined;
}

export function markStaleBetween(
  steps: WorkflowRunStepView[],
  targetStepId: string,
  fromStepId: string,
) {
  const targetIndex = steps.findIndex((step) => step.id === targetStepId);
  const fromIndex = steps.findIndex((step) => step.id === fromStepId);
  if (targetIndex === -1 || fromIndex === -1 || targetIndex >= fromIndex) return;
  for (const step of steps.slice(targetIndex + 1, fromIndex)) {
    if (step.status === "done") {
      step.status = "stale";
      step.note = `depends on ${targetStepId}`;
    }
  }
}

export function markStaleAfter(
  steps: WorkflowRunStepView[],
  targetStepId: string,
) {
  const targetIndex = steps.findIndex((step) => step.id === targetStepId);
  if (targetIndex === -1) return;
  for (const step of steps.slice(targetIndex + 1)) {
    if (step.boundary === "end") continue;
    if (step.status === "done" || step.status === "pending") {
      step.status = "stale";
      step.note = `depends on ${targetStepId}`;
    }
  }
}

export function stepIdFromEvent(event: EventRecord) {
  if (typeof event.stepId === "string") return event.stepId;
  const traceStepId = event.trace?.attributes?.stepId;
  if (typeof traceStepId === "string") return traceStepId;
  const parentSpanId = event.trace?.parentSpanId;
  if (typeof parentSpanId === "string") {
    const match = parentSpanId.match(/^step:(.+):attempt:\d+$/);
    if (match?.[1]) return match[1];
  }
  const spanId = event.trace?.spanId;
  if (typeof spanId === "string") {
    const match = spanId.match(/^step:(.+):attempt:\d+$/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export function questionsFromEvent(event: EventRecord): Question[] {
  const detail = event.detail as { questions?: unknown } | undefined;
  return Array.isArray(detail?.questions) ? detail.questions as Question[] : [];
}

export function scoreFromEvent(event: EventRecord) {
  const detail = event.detail as {
    evaluation?: { score?: unknown };
  } | undefined;
  const score = detail?.evaluation?.score;
  return typeof score === "number" && Number.isFinite(score) ? score : undefined;
}

export function scoreNote(event: EventRecord) {
  const detail = event.detail as {
    evaluation?: { score?: number; threshold?: number };
  } | undefined;
  const score = detail?.evaluation?.score;
  if (typeof score !== "number") return undefined;
  const threshold = detail?.evaluation?.threshold;
  const scoreText = `${Math.round(score * 100)}%`;
  return typeof threshold === "number"
    ? `${scoreText} / ${Math.round(threshold * 100)}%`
    : scoreText;
}

export function scoreStatus(event: EventRecord): WorkflowRunActivityView["status"] {
  const detail = event.detail as {
    evaluation?: { score?: number; status?: string; threshold?: number };
  } | undefined;
  if (detail?.evaluation?.status === "pass") return "ok";
  if (
    typeof detail?.evaluation?.score === "number" &&
    typeof detail?.evaluation?.threshold === "number" &&
    detail.evaluation.score < detail.evaluation.threshold
  ) return "error";
  return "info";
}

export function durationNote(event: EventRecord) {
  return typeof event.durationMs === "number" ? formatMs(event.durationMs) : undefined;
}

export function errorNote(event: EventRecord) {
  const detail = event.detail as { error?: unknown } | undefined;
  return typeof detail?.error === "string" ? detail.error : undefined;
}

export function retryNote(event: EventRecord) {
  const detail = event.detail as { maxRetries?: number; retries?: number } | undefined;
  if (typeof detail?.retries !== "number") return undefined;
  return typeof detail.maxRetries === "number"
    ? `retry ${detail.retries}/${detail.maxRetries}`
    : `retry ${detail.retries}`;
}

export function operationNote(event: EventRecord) {
  const detail = event.detail as { operation?: unknown; operationId?: unknown } | undefined;
  if (typeof detail?.operation === "string") return detail.operation;
  if (typeof detail?.operationId === "string") return detail.operationId;
  return event.trace?.name;
}

export function modelNote(model: WorkflowRunModelView | undefined) {
  if (!model) return undefined;
  return model.model ? `${model.worker ?? "model"}:${model.model}` : model.label ?? model.id;
}

export function isMeaningfulActivityEvent(event: EventRecord) {
  return event.type === "model.request.started" ||
    event.type === "model.request.failed" ||
    event.type === "model.request.retrying" ||
    event.type === "model.response.delta" ||
    event.type === "model.response.completed" ||
    event.type === "operation.started" ||
    event.type === "operation.completed" ||
    event.type === "operation.failed" ||
    event.type === "operation.progress" ||
    event.type === "worker.item.started" ||
    event.type === "worker.item.delta" ||
    event.type === "worker.item.completed" ||
    event.type === "worker.item.failed";
}

export function activityStatus(event: EventRecord): WorkflowRunActivityView["status"] {
  if (event.type.endsWith(".failed")) return "error";
  if (event.type.endsWith(".completed")) return "ok";
  if (event.type.endsWith(".retrying")) return "waiting";
  return "running";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatMs(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  return `${value}ms`;
}
