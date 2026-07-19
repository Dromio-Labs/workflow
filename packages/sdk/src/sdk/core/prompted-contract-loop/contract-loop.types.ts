import type {
  EvaluationBar,
  EvaluationBarQuestion,
} from "../evaluation/index.js";
import type { EventPayload } from "../loop/index.js";
import type {
  Question,
  QuestionResolution,
  QuestionResolutionHistoryItem,
} from "../questions/index.js";
import type { PromptedLoopPolicies } from "./policies.js";

export type ContractRequirement<
  TRequirementId extends string = string,
  TQuestionId extends string = string,
> = {
  id: TRequirementId;
  label: string;
  question?: Question & { id: TQuestionId };
  required?: boolean;
  status: "satisfied" | "missing" | "ambiguous" | "unsupported";
  value: unknown | null;
};

export type ContractStep<
  TStepId extends string = string,
  TPrimitiveId extends string = string,
  TRequirementId extends string = string,
> = {
  id: TStepId;
  label: string;
  primitive: TPrimitiveId;
  requirementIds: readonly TRequirementId[];
};

export type PromptedContract<
  TKind extends string = string,
  TRequirementId extends string = string,
  TQuestionId extends string = string,
  TStepId extends string = string,
  TPrimitiveId extends string = string,
> = {
  kind: TKind;
  questions?: readonly (Question & { id: TQuestionId })[];
  requirements: readonly ContractRequirement<TRequirementId, TQuestionId>[];
  steps?: readonly ContractStep<TStepId, TPrimitiveId, TRequirementId>[];
};

export type PromptedContractLoopContext<
  TInput,
  TContract extends PromptedContract,
  TAnswers extends Record<string, unknown>,
> = {
  answers: TAnswers;
  contract?: TContract;
  emit(event: EventPayload): Promise<void>;
  input: TInput;
  iteration: number;
  trace?: PromptedContractLoopTraceInput;
};

export type PromptedContractLoopTraceInput = {
  parentSpanId?: string;
  spanId?: string;
  traceId?: string;
};

export type AnswerEvaluationResult<TQuestionId extends string = string> = {
  evaluation?: EvaluationBar<`answer:${TQuestionId}`>;
  resolution: QuestionResolution;
};

export type PromptedContractLoopDefinition<
  TInput = unknown,
  TContract extends PromptedContract = PromptedContract,
  TAnswers extends Record<string, unknown> = Record<string, unknown>,
  TLoopId extends string = string,
> = PromptedLoopPolicies & {
  answerEvaluator?: (input: {
    answers: TAnswers;
    contract: TContract;
    history: QuestionResolutionHistoryItem[];
    question: Question;
    trace?: PromptedContractLoopTraceInput;
    utterance: unknown;
  }) => Promise<AnswerEvaluationResult | QuestionResolution> | AnswerEvaluationResult | QuestionResolution;
  createQuestions?: (input: {
    answers: TAnswers;
    contract: TContract;
    evaluation: EvaluationBar;
  }) => readonly Question[];
  evaluateContract(input: {
    answers: TAnswers;
    contract: TContract;
    input: TInput;
    iteration: number;
  }): Promise<EvaluationBar> | EvaluationBar;
  id: TLoopId;
  label?: string;
  mergeAnswer?: (input: {
    answers: TAnswers;
    contract: TContract;
    question: Question;
    resolution: QuestionResolution;
    value: unknown;
  }) => Promise<TAnswers> | TAnswers;
  resolveContract(input: PromptedContractLoopContext<TInput, TContract, TAnswers>): Promise<TContract> | TContract;
};

export type PromptedContractLoopResult<TContract extends PromptedContract> =
  | {
      contract: TContract;
      evaluation: EvaluationBar;
      pendingQuestions: [];
      status: "completed";
    }
  | {
      contract: TContract;
      evaluation: EvaluationBar;
      pendingQuestions: Question[];
      status: "needs_input";
    }
  | {
      contract?: TContract;
      evaluation?: EvaluationBar;
      pendingQuestions: Question[];
      status: "failed";
      message: string;
    };

export type RunPromptedContractLoopInput<
  TInput,
  TAnswers extends Record<string, unknown>,
> = {
  answers?: TAnswers;
  input: TInput;
  onEvent?: (event: EventPayload) => void | Promise<void>;
  onQuestion?: (question: Question) => Promise<unknown> | unknown;
  trace?: PromptedContractLoopTraceInput;
};
