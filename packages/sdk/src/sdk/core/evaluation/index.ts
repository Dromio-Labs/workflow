import type { CandidateScorePolicy } from "./candidate.types.js";

export type {
  CandidateEvaluation,
  CandidateEvaluationFinding,
  CandidateEvaluationInput,
  CandidateEvaluationItem,
  CandidateEvaluationSeverity,
  CandidateEvaluationStatus,
  CandidateEvaluator,
  CandidateNextAction,
  CandidateScoreCriterion,
  CandidateScoreFindingDefinition,
  CandidateScoreGate,
  CandidateScorePolicy,
  CandidateScorePolicyGapId,
  CandidateScorePolicyGateId,
  CandidateScorePolicyId,
  CandidateScorePolicyRiskId,
  CandidateScorePolicySatisfyId,
} from "./candidate.types.js";
export type {
  EvaluationBar,
  EvaluationBarQuestion,
  EvaluationBarStatus,
  EvaluationCompletedEventDetail,
} from "./evaluation-bars.js";

export {
  candidateEvaluationStatusSchema,
  candidateNextActionSchema,
} from "./schema.js";
export {
  defineEvaluationBar,
  evaluationBarFromCandidate,
  evaluationBarFromPolicy,
  evaluationBarMessage,
  evaluationCompletedEvent,
  passingThreshold,
  renderEvaluationBar,
} from "./evaluation-bars.js";

export function defineCandidateScorePolicy<const TPolicy extends CandidateScorePolicy>(
  input: TPolicy,
): TPolicy {
  return input;
}

export { defineScorePolicy } from "../prompted-operation/index.js";
