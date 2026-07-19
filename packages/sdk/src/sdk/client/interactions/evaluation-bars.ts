import type {
  EvaluationBar,
  EventRecord,
} from "../../core/index.js";
import type { EvaluationBarFeedback } from "./interaction.types.js";

export function projectEvaluationBars(events: EventRecord[]): EvaluationBarFeedback[] {
  return events.flatMap((event) => {
    if (event.type !== "evaluation.completed") return [];
    const evaluation = (event.detail as { evaluation?: EvaluationBar } | undefined)?.evaluation;
    if (!evaluation) return [];
    return [{
      eventIndex: event.index,
      gaps: evaluation.gaps,
      id: `${event.runId}:${event.index}:evaluation-bar:${evaluation.subjectId}`,
      label: evaluation.label,
      message: evaluation.message,
      nextAction: evaluation.nextAction,
      questions: evaluation.questions,
      risks: evaluation.risks,
      satisfies: evaluation.satisfies,
      score: evaluation.score,
      scorePolicyId: evaluation.scorePolicyId,
      status: evaluation.status,
      subjectId: evaluation.subjectId,
      threshold: evaluation.threshold,
    }];
  });
}
