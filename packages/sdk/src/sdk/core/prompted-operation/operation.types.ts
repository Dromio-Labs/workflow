import type { EventPayload } from "../loop/index.js";
import type {
  InferOperationContractSource,
  OperationContract,
  OperationContractSourceLike,
} from "./contracts.js";
import type { PromptedOperationTraceInput } from "./trace-events.js";

export type PromptedOperationContext<TInput> = {
  emit(event: EventPayload): Promise<void>;
  input: TInput;
  inputContractId: string;
  inputJsonSchema?: unknown;
  onEvent?: (event: EventPayload) => void | Promise<void>;
  operationId: string;
  outputContractId: string;
  outputJsonSchema?: unknown;
  trace?: PromptedOperationTraceInput;
};

export type PromptedOperationDefinition<
  TInput = unknown,
  TOutput = unknown,
  TId extends string = string,
> = {
  execute(input: TInput, context: PromptedOperationContext<TInput>): Promise<unknown> | unknown;
  id: TId;
  input: OperationContract<TInput>;
  label?: string;
  output: OperationContract<TOutput>;
  parseOutput?: (rawOutput: unknown, context: PromptedOperationContext<TInput>) => unknown;
};

export type PromptedOperationDefinitionInput<
  TInputSource extends OperationContractSourceLike,
  TOutputSource extends OperationContractSourceLike,
  TId extends string = string,
> = {
  execute(
    input: InferOperationContractSource<TInputSource>,
    context: PromptedOperationContext<InferOperationContractSource<TInputSource>>,
  ): Promise<unknown> | unknown;
  id: TId;
  input: TInputSource;
  label?: string;
  output: TOutputSource;
  parseOutput?: (
    rawOutput: unknown,
    context: PromptedOperationContext<InferOperationContractSource<TInputSource>>,
  ) => unknown;
};

export type RunPromptedOperationInput<
  TInput,
  TOutput,
  TId extends string,
> = {
  input: unknown;
  onEvent?: (event: EventPayload) => void | Promise<void>;
  operation: PromptedOperationDefinition<TInput, TOutput, TId>;
  trace?: PromptedOperationTraceInput;
};

export type PromptedOperationResult<TOutput> = {
  output: TOutput;
  rawOutput: unknown;
};
