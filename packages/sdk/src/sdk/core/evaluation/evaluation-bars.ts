import type { EventPayload } from "../loop/index.js";
import type {
  CandidateEvaluation,
  CandidateEvaluationFinding,
  CandidateEvaluationItem,
  CandidateEvaluationStatus,
  CandidateNextAction,
  CandidateScorePolicy,
} from "./candidate.types.js";

export type EvaluationBarStatus = CandidateEvaluationStatus;

export type EvaluationBarQuestion<TQuestionId extends string = string> = {
  id: TQuestionId;
  options?: Array<{
    description?: string;
    label: string;
    value: string;
  }>;
  prompt: string;
  recommendedOptionId?: string;
  title?: string;
  type?: string;
};

export type EvaluationBar<
  TSubjectId extends string = string,
  TSatisfyId extends string = string,
  TGapId extends string = string,
  TRiskId extends string = string,
  TQuestionId extends string = string,
> = {
  gaps: CandidateEvaluationFinding<TGapId>[];
  label: string;
  message?: string;
  nextAction?: CandidateNextAction;
  questions: EvaluationBarQuestion<TQuestionId>[];
  risks: CandidateEvaluationFinding<TRiskId>[];
  satisfies: CandidateEvaluationItem<TSatisfyId>[];
  score: number;
  scorePolicyId?: string;
  status: EvaluationBarStatus;
  subjectId: TSubjectId;
  threshold: number;
};

export type EvaluationCompletedEventDetail<TBar extends EvaluationBar = EvaluationBar> = {
  evaluation: TBar;
};

export function defineEvaluationBar<const TBar extends EvaluationBar>(bar: TBar): TBar {
  return normalizeEvaluationBar(bar) as TBar;
}

export function evaluationCompletedEvent<const TBar extends EvaluationBar>(input: {
  bar: TBar;
  message?: string;
  trace?: EventPayload["trace"];
}): EventPayload {
  return {
    detail: { evaluation: normalizeEvaluationBar(input.bar) },
    message: input.message ?? evaluationBarMessage(input.bar),
    trace: input.trace,
    type: "evaluation.completed",
  };
}

export function evaluationBarFromCandidate<
  const TSubjectId extends string,
  TSatisfyId extends string,
  TGapId extends string,
  TRiskId extends string,
  TGateId extends string,
>(input: {
  evaluation: CandidateEvaluation<TSatisfyId, TGapId, TRiskId, TGateId>;
  label: string;
  questions?: EvaluationBarQuestion[];
  subjectId: TSubjectId;
  threshold: number;
}): EvaluationBar<TSubjectId, TSatisfyId, TGapId, TRiskId> {
  return normalizeEvaluationBar({
    gaps: input.evaluation.gaps,
    label: input.label,
    message: input.evaluation.message,
    nextAction: input.evaluation.nextAction,
    questions: input.questions ?? [],
    risks: input.evaluation.risks,
    satisfies: input.evaluation.satisfies,
    score: input.evaluation.score,
    scorePolicyId: input.evaluation.scorePolicyId,
    status: input.evaluation.status,
    subjectId: input.subjectId,
    threshold: input.threshold,
  });
}

export function evaluationBarFromPolicy(input: {
  evaluation: {
    message?: string;
    nextAction?: CandidateNextAction;
    score: number;
    scorePolicyId?: string;
    status: CandidateEvaluationStatus;
  };
  label: string;
  policy: CandidateScorePolicy;
  questions?: EvaluationBarQuestion[];
  subjectId: string;
}): EvaluationBar {
  const threshold = passingThreshold(input.policy);
  const passed = input.evaluation.score >= threshold && input.evaluation.status === "pass";
  return normalizeEvaluationBar({
    gaps: passed
      ? []
      : input.policy.gaps.map((gap) => ({
          id: gap.id,
          message: gap.description,
          severity: gap.severity,
        })),
    label: input.label,
    message: input.evaluation.message,
    nextAction: input.evaluation.nextAction,
    questions: input.questions ?? [],
    risks: input.policy.risks.map((risk) => ({
      id: risk.id,
      message: risk.description,
      severity: risk.severity,
    })),
    satisfies: input.policy.satisfies.map((item) => ({
      id: item.id,
      passed,
      reason: item.description,
    })),
    score: input.evaluation.score,
    scorePolicyId: input.evaluation.scorePolicyId ?? input.policy.id,
    status: input.evaluation.status,
    subjectId: input.subjectId,
    threshold,
  });
}

export function renderEvaluationBar(bar: Pick<EvaluationBar, "score" | "status" | "threshold">, width = 10): string {
  const boundedWidth = Math.max(4, Math.min(30, Math.round(width)));
  const filled = Math.max(0, Math.min(boundedWidth, Math.round(clamp(bar.score) * boundedWidth)));
  return `[${"█".repeat(filled)}${"░".repeat(boundedWidth - filled)}] ${Math.round(clamp(bar.score) * 100)}% ${bar.status}`;
}

export function evaluationBarMessage(bar: Pick<EvaluationBar, "label" | "score" | "status">) {
  return `${bar.label} ${Math.round(clamp(bar.score) * 100)}% ${bar.status}.`;
}

export function passingThreshold(policy: CandidateScorePolicy): number {
  const passGates = policy.gates.filter((gate) => gate.status === "pass");
  if (passGates.length === 0) return 0.8;
  return Math.min(...passGates.map((gate) => gate.minScore));
}

function normalizeEvaluationBar<TBar extends EvaluationBar>(bar: TBar): TBar {
  return {
    ...bar,
    score: clamp(bar.score),
    threshold: clamp(bar.threshold),
  };
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
