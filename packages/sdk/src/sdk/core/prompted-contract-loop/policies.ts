import type { Question } from "../questions/index.js";

export type PromptedLoopScorePolicy<TId extends string = string> = {
  defaultThreshold?: number;
  id: TId;
};

export type PromptedLoopQuestionPolicy<TId extends string = string> = {
  id: TId;
  maxAnswerAttempts?: number;
  maxQuestionsPerTurn?: number;
  preferOptions?: boolean;
  requireRecommendedOption?: boolean;
};

export type PromptedLoopAmbiguityPolicy<TId extends string = string> = {
  id: TId;
  subjectivePhrases?: readonly string[];
};

export type PromptedLoopAnswerEvaluationPolicy<TId extends string = string> = {
  acceptanceThreshold?: number;
  id: TId;
  useHistory?: boolean;
};

export type PromptedLoopTracePolicy<TId extends string = string> = {
  emitEvaluationBars?: boolean;
  emitRawModelDeltas?: boolean;
  id: TId;
};

export type PromptedLoopProviderPolicy<TId extends string = string> = {
  baseUrl?: string;
  id: TId;
  model?: string;
  provider?: string;
  setupErrorMessage?: string;
};

export type PromptedLoopRevisionPolicy<TId extends string = string> = {
  failWhenExceeded?: boolean;
  id: TId;
  maxContractLoops?: number;
  maxOutputFixLoops?: number;
};

export type PromptedLoopPolicies = {
  ambiguityPolicy?: PromptedLoopAmbiguityPolicy;
  answerEvaluationPolicy?: PromptedLoopAnswerEvaluationPolicy;
  providerPolicy?: PromptedLoopProviderPolicy;
  questionPolicy?: PromptedLoopQuestionPolicy;
  revisionPolicy?: PromptedLoopRevisionPolicy;
  scorePolicy?: PromptedLoopScorePolicy;
  tracePolicy?: PromptedLoopTracePolicy;
};

export type RecommendedQuestion<TQuestion extends Question = Question> = TQuestion & {
  recommendedOptionId?: string;
};

export function defineQuestionPolicy<const TPolicy extends PromptedLoopQuestionPolicy>(policy: TPolicy): TPolicy {
  return policy;
}

export function defineAmbiguityPolicy<const TPolicy extends PromptedLoopAmbiguityPolicy>(policy: TPolicy): TPolicy {
  return policy;
}

export function defineAnswerEvaluationPolicy<const TPolicy extends PromptedLoopAnswerEvaluationPolicy>(policy: TPolicy): TPolicy {
  return policy;
}

export function defineTracePolicy<const TPolicy extends PromptedLoopTracePolicy>(policy: TPolicy): TPolicy {
  return policy;
}

export function defineProviderPolicy<const TPolicy extends PromptedLoopProviderPolicy>(policy: TPolicy): TPolicy {
  return policy;
}

export function defineRevisionPolicy<const TPolicy extends PromptedLoopRevisionPolicy>(policy: TPolicy): TPolicy {
  return policy;
}
