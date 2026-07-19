import type {
  EventPayload,
  TraceAttributeValue,
} from "../../../core/index.js";
import type {
  OpenAiCompatibleChatInput,
} from "./types.js";
import {
  slug,
} from "./utils.js";

export async function emitRetry(
  input: OpenAiCompatibleChatInput,
  attempt: number,
  maxAttempts: number,
  error: string,
) {
  const spanId = input.trace?.spanId ?? `model:${slug(input.operation)}`;
  const traceId = input.trace?.traceId ?? "provider";
  const attributes = {
    attempt,
    baseUrl: input.baseUrl,
    error,
    maxAttempts,
    model: input.model,
    operation: input.operation,
    provider: input.provider,
  };
  await emitModelEvent(input, {
    detail: attributes,
    message: `Retrying ${input.operation}: ${error}`,
    trace: modelTrace({
      attributes,
      input,
      spanId,
      status: "unset",
      traceId,
    }),
    type: "model.request.retrying",
  });
}

export async function emitFailure(
  input: OpenAiCompatibleChatInput,
  spanId: string,
  traceId: string,
  attributes: Record<string, TraceAttributeValue>,
  error: string,
) {
  await emitModelEvent(input, {
    detail: {
      ...attributes,
      error,
    },
    message: `Failed ${input.operation}: ${error}`,
    trace: modelTrace({
      attributes,
      input,
      spanId,
      status: "error",
      traceId,
    }),
    type: "model.request.failed",
  });
}

export async function emitModelEvent(input: OpenAiCompatibleChatInput, event: EventPayload) {
  await input.onEvent?.(event);
}

export function modelTrace(input: {
  attributes: Record<string, TraceAttributeValue>;
  input: OpenAiCompatibleChatInput;
  spanId: string;
  status: "error" | "ok" | "unset";
  traceId: string;
}) {
  return {
    attributes: input.attributes,
    kind: "client" as const,
    name: input.input.operation,
    parentSpanId: input.input.trace?.parentSpanId,
    spanId: input.spanId,
    status: input.status,
    traceId: input.traceId,
  };
}
