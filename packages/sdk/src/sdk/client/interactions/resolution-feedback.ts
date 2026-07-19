import type { EventRecord } from "../../core/loop/index.js";
import type { QuestionResolutionFeedback } from "./interaction.types.js";

export function projectQuestionResolutions(events: EventRecord[]): QuestionResolutionFeedback[] {
  return events.flatMap((event) => {
    if (event.type !== "question.resolution.completed" && event.type !== "question.resolution.rejected") {
      return [];
    }
    const detail = event.detail as {
      confidence?: number;
      kind?: QuestionResolutionFeedback["kind"];
      message?: string;
      normalizedValue?: unknown;
      questionId?: string;
      resolverId?: string;
      status?: QuestionResolutionFeedback["status"];
      suggestedValue?: unknown;
      targetRequirementIds?: string[];
    } | undefined;
    if (!detail?.questionId || !detail.kind || !detail.status) return [];
    return [{
      confidence: typeof detail.confidence === "number" ? detail.confidence : 0,
      eventIndex: event.index,
      id: `${event.runId}:${event.index}:question-resolution`,
      kind: detail.kind,
      message: detail.message,
      normalizedValue: detail.normalizedValue,
      questionId: detail.questionId,
      resolverId: detail.resolverId,
      status: detail.status,
      suggestedValue: detail.suggestedValue,
      targetRequirementIds: detail.targetRequirementIds,
    }];
  });
}
