import type { EventPayload, TraceContext } from "../loop/index.js";

export type PromptedOperationTraceInput = {
  parentSpanId?: string;
  spanId?: string;
  traceId?: string;
  workflowId?: string;
};

export type PromptedOperationEventType =
  | "operation.started"
  | "operation.progress"
  | "output.parsed"
  | "operation.completed"
  | "operation.failed";

export type PromptedOperationEventDetail = {
  contractId?: string;
  durationMs?: number;
  issue?: string;
  operationId: string;
  outputContractId?: string;
  stage?: string;
};

export function operationTrace(input: {
  attributes?: TraceContext["attributes"];
  name: string;
  operationId: string;
  status?: TraceContext["status"];
  trace?: PromptedOperationTraceInput;
}): TraceContext {
  return {
    attributes: {
      operationId: input.operationId,
      ...(input.trace?.workflowId ? { workflowId: input.trace.workflowId } : {}),
      ...(input.attributes ?? {}),
    },
    kind: "internal",
    name: input.name,
    parentSpanId: input.trace?.parentSpanId,
    spanId: input.trace?.spanId ?? `operation:${input.operationId}`,
    status: input.status ?? "unset",
    traceId: input.trace?.traceId ?? "prompted-operation",
  };
}

export function promptedOperationEvent(input: {
  detail: PromptedOperationEventDetail;
  message: string;
  trace: TraceContext;
  type: PromptedOperationEventType;
}): EventPayload {
  return {
    detail: input.detail,
    message: input.message,
    trace: input.trace,
    type: input.type,
  };
}
