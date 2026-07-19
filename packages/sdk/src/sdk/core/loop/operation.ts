import type {
  EventPayload,
  StepRuntimeMetadata,
  TraceContext,
} from "./loop.types.js";
import type {
  StepOperationContext,
  StepOperationDetail,
  StepOperationInput,
  StepOperationProgress,
} from "./operation.types.js";

type RunStepOperationInput<T> = {
  emit(event: EventPayload): void;
  operation: StepOperationInput;
  run(context: StepOperationContext): Promise<T> | T;
  step: StepRuntimeMetadata;
};

export async function runStepOperation<T>(input: RunStepOperationInput<T>): Promise<T> {
  const startedAt = performance.now();
  const idempotencyKey = input.operation.idempotencyKey
    ?? `${input.step.idempotencyKey}:${input.operation.id}`;
  const detail = {
    ...(input.operation.detail ?? {}),
    attempt: input.step.attempt,
    idempotencyKey,
    operationId: input.operation.id,
  };
  const trace = operationTrace(input.step, input.operation.id, idempotencyKey);
  input.emit({
    detail,
    message: `Started ${input.operation.label ?? input.operation.id}.`,
    trace,
    type: "operation.started",
  });
  try {
    const result = await input.run({
      attempt: input.step.attempt,
      idempotencyKey,
      operationId: input.operation.id,
      progress(progress) {
        input.emit(operationProgressEvent(input, progress, detail, trace));
      },
    });
    input.emit({
      detail: { ...detail, durationMs: elapsedMs(startedAt) },
      message: `Completed ${input.operation.label ?? input.operation.id}.`,
      trace: { ...trace, status: "ok" },
      type: "operation.completed",
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.emit({
      detail: { ...detail, durationMs: elapsedMs(startedAt), error: message },
      message: `Failed ${input.operation.label ?? input.operation.id}: ${message}`,
      trace: { ...trace, status: "error" },
      type: "operation.failed",
    });
    throw error;
  }
}

function operationProgressEvent<T>(
  input: RunStepOperationInput<T>,
  progress: StepOperationProgress,
  detail: StepOperationDetail,
  trace: TraceContext,
): EventPayload {
  return {
    detail: { ...detail, ...(progress.detail ?? {}) },
    message: progress.message,
    trace,
    type: "operation.progress",
  };
}

function operationTrace(
  step: StepRuntimeMetadata,
  operationId: string,
  idempotencyKey: string,
): TraceContext {
  return {
    attributes: {
      attempt: step.attempt,
      idempotencyKey,
      operationId,
      stepId: step.id,
    },
    kind: "internal",
    name: operationId,
    parentSpanId: `step:${step.id}:attempt:${step.attempt}`,
    spanId: `operation:${step.id}:${operationId}:attempt:${step.attempt}`,
    status: "unset",
    traceId: step.runId,
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
