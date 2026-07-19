import type { CandidateEvaluation } from "../../core/index.js";
import type { EventRecord } from "../../core/loop/index.js";
import type { CandidateEvaluationFeedback } from "./interaction.types.js";

export function projectCandidateEvaluations(events: EventRecord[]): CandidateEvaluationFeedback[] {
  return events.flatMap((event) => {
    if (event.type !== "candidate.evaluation.completed") {
      return [];
    }
    const evaluation = (event.detail as { evaluation?: CandidateEvaluation } | undefined)?.evaluation;
    if (!evaluation) return [];
    return [{
      eventIndex: event.index,
      gaps: evaluation.gaps,
      gateId: evaluation.gateId,
      id: `${event.runId}:${event.index}:candidate-evaluation`,
      message: evaluation.message,
      nextAction: evaluation.nextAction,
      risks: evaluation.risks,
      satisfies: evaluation.satisfies,
      score: evaluation.score,
      scorePolicyId: evaluation.scorePolicyId,
      status: evaluation.status,
    }];
  });
}
