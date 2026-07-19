import type {
  CandidateEvaluationStatus,
  CandidateNextAction,
  CandidateScoreGate,
  CandidateScorePolicy,
} from "../evaluation/candidate.types.js";

export type PromptedOperationDecisionStatus =
  | "completed"
  | "needs_input"
  | "revise"
  | "rejected"
  | "failed";

export type PromptedOperationDecision = {
  gateId?: string;
  message?: string;
  nextAction: CandidateNextAction;
  score: number;
  scorePolicyId: string;
  status: PromptedOperationDecisionStatus;
};

export type PromptedOperationEvaluation = {
  gateId?: string;
  message?: string;
  nextAction: CandidateNextAction;
  score: number;
  scorePolicyId?: string;
  status: CandidateEvaluationStatus;
};

export function defineScorePolicy<const TPolicy extends CandidateScorePolicy>(
  policy: TPolicy,
): TPolicy {
  return policy;
}

export function chooseScoreGate<TGateId extends string>(
  gates: readonly CandidateScoreGate<TGateId>[],
  score: number,
  requestedGateId?: string,
) {
  const requested = requestedGateId
    ? gates.find((gate) => gate.id === requestedGateId)
    : undefined;
  if (requested && score >= requested.minScore) return requested;
  return [...gates]
    .sort((left, right) => right.minScore - left.minScore)
    .find((gate) => score >= gate.minScore);
}

export function decisionFromEvaluation(input: {
  evaluation: PromptedOperationEvaluation;
  scorePolicy: CandidateScorePolicy;
}): PromptedOperationDecision {
  const gate = chooseScoreGate(
    input.scorePolicy.gates,
    input.evaluation.score,
    input.evaluation.gateId,
  );
  const status = decisionStatus(input.evaluation.status, gate?.status);
  return {
    gateId: gate?.id ?? input.evaluation.gateId,
    message: input.evaluation.message,
    nextAction: gate?.nextAction ?? input.evaluation.nextAction ?? "revise",
    score: clamp(input.evaluation.score),
    scorePolicyId: input.evaluation.scorePolicyId ?? input.scorePolicy.id,
    status,
  };
}

function decisionStatus(
  status: CandidateEvaluationStatus,
  gateStatus?: CandidateEvaluationStatus,
): PromptedOperationDecisionStatus {
  const effective = gateStatus ?? status;
  if (effective === "pass") return "completed";
  if (effective === "needs_input") return "needs_input";
  if (effective === "revise") return "revise";
  return "failed";
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
