import type {
  CandidateScorePolicy,
  EventPayload,
  PromptedOperationEvaluation,
  Question,
  QuestionOption,
  InferOperationContractSource,
  StepOptions,
  StepContractSourceMap,
} from "../../core/index.js";
import type { z } from "zod";
import type {
  ModelWorkerSource,
  ModelWorkerTraceInput,
} from "../model/index.js";
import type {
  PromptSource,
} from "../prompts/index.js";
import type {
  requestIntakeAnsweredQuestionSchema,
  requestIntakeEvaluationSchema,
  requestIntakeQuestionSchema,
  requestIntakeRequestSchema,
} from "./schema.js";

export type RequestIntakeAnsweredQuestion = z.infer<typeof requestIntakeAnsweredQuestionSchema>;
export type RequestIntakeQuestion = z.infer<typeof requestIntakeQuestionSchema>;
export type RequestIntakeEvaluation = z.infer<typeof requestIntakeEvaluationSchema>;
export type RequestIntakeRequest = z.infer<typeof requestIntakeRequestSchema>;

export type RequestIntakeOperationInput<TRequest = unknown> = {
  answeredQuestions: RequestIntakeAnsweredQuestion[];
  originalPrompt: string;
  previousEvaluation?: PromptedOperationEvaluation;
  previousRequest?: TRequest;
};

export type RequestIntakeOperationContext = {
  emit: (event: EventPayload) => void | Promise<void>;
  trace?: ModelWorkerTraceInput;
};

export type RequestIntakePrompts = {
  clarify: PromptSource;
  evaluate: PromptSource;
};

type InferRequestIntakeStepInput<TInputContracts extends StepContractSourceMap | undefined> =
  TInputContracts extends StepContractSourceMap
    ? { [K in keyof TInputContracts]: InferOperationContractSource<TInputContracts[K]> }
    : unknown;

export type RequestIntakeProductStepInput<
  TOutputContracts extends StepContractSourceMap,
  TInputContracts extends StepContractSourceMap | undefined = undefined,
> =
  Omit<StepOptions, "input" | "kind" | "output"> & {
    assumeOption?: false | QuestionOption;
    id?: string;
    input?: TInputContracts;
    maxAutoRevisions?: number;
    maxQuestions?: number;
    operationNames?: {
      clarify?: string;
      evaluate?: string;
    };
    model?: ModelWorkerSource;
    operationModels?: {
      clarify?: ModelWorkerSource;
      evaluate?: ModelWorkerSource;
    };
    originalPrompt?: (input: {
      input: InferRequestIntakeStepInput<TInputContracts>;
      state: Record<string, unknown>;
      workflowInput: unknown;
    }) => string;
    output: TOutputContracts;
    prompts: RequestIntakePrompts;
    scorePolicy?: CandidateScorePolicy;
    worker?: {
      completeJson<TSchema extends { safeParse(value: unknown): unknown }>(
        input: {
          onEvent?: (event: EventPayload) => void | Promise<void>;
          operation: string;
          schema: TSchema;
          systemPrompt?: string;
          trace?: ModelWorkerTraceInput;
          userPrompt?: string;
        },
      ): Promise<unknown>;
    };
  };

export type RequestIntakeWorkflowQuestion = Question & {
  allowCustom?: boolean;
};
