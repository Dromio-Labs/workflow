import type {
  EventPayload,
  StepRuntimeMetadata,
  TraceContext,
} from "../loop.types.js";
import type {
  Question,
  QuestionResolution,
} from "../../questions/index.js";

export function defaultTraceContext(input: {
  event: EventPayload;
  runId: string;
  step?: StepRuntimeMetadata;
  workflowId: string;
}): TraceContext {
  const traceId = input.runId;
  if (input.step) {
    const durationMs = typeof input.event.durationMs === "number"
      ? input.event.durationMs
      : undefined;
    return {
      attributes: {
        attempt: input.step.attempt,
        ...(durationMs !== undefined ? { durationMs } : {}),
        eventType: input.event.type,
        stepId: input.step.id,
      },
      kind: "internal",
      name: input.step.id,
      parentSpanId: `run:${input.runId}`,
      spanId: `step:${input.step.id}:attempt:${input.step.attempt}`,
      status: statusForEvent(input.event.type),
      traceId,
    };
  }
  return {
    attributes: {
      eventType: input.event.type,
      workflowId: input.workflowId,
    },
    kind: "internal",
    name: input.workflowId,
    spanId: `run:${input.runId}`,
    status: statusForEvent(input.event.type),
    traceId,
  };
}

export function questionShapeToken(question: Question) {
  const value = JSON.stringify({
    allowCustom: "allowCustom" in question ? question.allowCustom : undefined,
    answerSchema: question.answerSchema,
    options: (question.options ?? []).map((option) => ({
      description: option.description,
      label: option.label,
      value: option.value,
    })),
    prompt: question.prompt,
    requirementId: question.requirementId,
    resolverId: question.resolverId,
    title: question.title,
    type: question.type,
  });
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function resolutionDetail(
  questionId: string,
  resolverId: string | undefined,
  result: QuestionResolution,
) {
  return {
    confidence: result.confidence,
    kind: result.kind,
    message: result.message,
    normalizedValue: result.status === "accepted" ? result.normalizedValue : undefined,
    questionId,
    resolverId,
    status: result.status,
    suggestedValue: result.status === "needs_input" ? result.suggestedValue : undefined,
    targetRequirementIds: result.status === "revision" ? result.targetRequirementIds : undefined,
  };
}

function statusForEvent(type: string): TraceContext["status"] {
  if (type.endsWith(".failed")) return "error";
  if (type.endsWith(".completed") || type.endsWith(".resumed") || type.endsWith(".answered")) return "ok";
  return "unset";
}
