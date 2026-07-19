import type { EventPayload } from "../loop/index.js";

export type CandidateEvaluationSeverity = "low" | "medium" | "high";

export type CandidateEvaluationItem<TId extends string = string> = {
  id: TId;
  passed: boolean;
  reason: string;
};

export type CandidateEvaluationFinding<TId extends string = string> = {
  id: TId;
  message: string;
  severity: CandidateEvaluationSeverity;
};

export type CandidateNextAction =
  | "ask"
  | "suggest"
  | "confirm"
  | "revise"
  | "execute"
  | "complete"
  | "cancel";

export type CandidateEvaluationStatus =
  | "pass"
  | "needs_input"
  | "revise"
  | "fail";

export type CandidateScoreCriterion<TId extends string = string> = {
  description: string;
  id: TId;
  weight?: number;
};

export type CandidateScoreFindingDefinition<TId extends string = string> = {
  description: string;
  id: TId;
  severity: CandidateEvaluationSeverity;
};

export type CandidateScoreGate<TId extends string = string> = {
  id: TId;
  minScore: number;
  nextAction: CandidateNextAction;
  status: CandidateEvaluationStatus;
};

export type CandidateScorePolicy<
  TPolicyId extends string = string,
  TSatisfyId extends string = string,
  TGapId extends string = string,
  TRiskId extends string = string,
  TGateId extends string = string,
> = {
  gaps: readonly CandidateScoreFindingDefinition<TGapId>[];
  gates: readonly CandidateScoreGate<TGateId>[];
  id: TPolicyId;
  risks: readonly CandidateScoreFindingDefinition<TRiskId>[];
  satisfies: readonly CandidateScoreCriterion<TSatisfyId>[];
};

export type CandidateScorePolicyId<TPolicy extends CandidateScorePolicy> = TPolicy["id"];
export type CandidateScorePolicySatisfyId<TPolicy extends CandidateScorePolicy> = TPolicy["satisfies"][number]["id"];
export type CandidateScorePolicyGapId<TPolicy extends CandidateScorePolicy> = TPolicy["gaps"][number]["id"];
export type CandidateScorePolicyRiskId<TPolicy extends CandidateScorePolicy> = TPolicy["risks"][number]["id"];
export type CandidateScorePolicyGateId<TPolicy extends CandidateScorePolicy> = TPolicy["gates"][number]["id"];

export type CandidateEvaluation<
  TSatisfyId extends string = string,
  TGapId extends string = string,
  TRiskId extends string = string,
  TGateId extends string = string,
> = {
  gaps: CandidateEvaluationFinding<TGapId>[];
  gateId?: TGateId;
  message?: string;
  nextAction: CandidateNextAction;
  risks: CandidateEvaluationFinding<TRiskId>[];
  satisfies: CandidateEvaluationItem<TSatisfyId>[];
  score: number;
  scorePolicyId?: string;
  status: CandidateEvaluationStatus;
};

export type CandidateEvaluationInput = {
  candidate: unknown;
  context?: Record<string, unknown>;
  intent?: unknown;
  onEvent?: (event: EventPayload) => void | Promise<void>;
  state?: Record<string, unknown>;
  trace?: {
    parentSpanId?: string;
    spanId?: string;
    traceId?: string;
  };
};

export type CandidateEvaluator<
  TSatisfyId extends string = string,
  TGapId extends string = string,
  TRiskId extends string = string,
  TGateId extends string = string,
> = {
  evaluate(input: CandidateEvaluationInput): Promise<CandidateEvaluation<TSatisfyId, TGapId, TRiskId, TGateId>> | CandidateEvaluation<TSatisfyId, TGapId, TRiskId, TGateId>;
  id: string;
};
