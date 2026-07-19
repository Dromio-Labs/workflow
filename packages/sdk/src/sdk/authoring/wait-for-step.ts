import { z } from "zod";
import {
  createHook,
  type InferOperationContractSource,
  type InferStepContractInput,
  type InferStepContractOutput,
  type OperationContractSourceLike,
  type StepContractSourceMap,
} from "../core/index.js";
import { baseStep, type AuthoredStepDefinition } from "./step.js";
import {
  signalCorrelationHash,
  type SignalDefinition,
} from "./signal.js";

export type SignalWaitValue<TPayload> = {
  occurrenceId: string;
  occurredAt: string;
  payload: TPayload;
};

export type SignalWaitHookInput<TCorrelation> = {
  contractFingerprint: string;
  correlation: TCorrelation;
  correlationHash: string;
  signalId: string;
};

export type AuthoredWaitForStepInput<
  TInput extends StepContractSourceMap,
  TCorrelation extends OperationContractSourceLike,
  TPayload extends OperationContractSourceLike,
> = {
  correlation(input: {
    input: InferStepContractInput<TInput>;
  }): InferOperationContractSource<TCorrelation>;
  description?: string;
  id: string;
  input: TInput;
  label?: string;
  signal: SignalDefinition<TCorrelation, TPayload>;
};

export type AuthoredWaitForStepDefinition<
  TInput extends StepContractSourceMap,
  TPayload extends OperationContractSourceLike,
> = AuthoredStepDefinition<TInput, {
  occurrenceId: z.ZodString;
  occurredAt: z.ZodString;
  payload: TPayload;
}>;

export function waitForStep<
  const TInput extends StepContractSourceMap,
  const TCorrelation extends OperationContractSourceLike,
  const TPayload extends OperationContractSourceLike,
>(
  input: AuthoredWaitForStepInput<TInput, TCorrelation, TPayload>,
): AuthoredWaitForStepDefinition<TInput, TPayload> {
  return baseStep({
    description: input.description,
    id: input.id,
    input: input.input,
    implementation: { kind: "primitive" },
    kind: "step",
    label: input.label,
    output: {
      occurrenceId: z.string(),
      occurredAt: z.string(),
      payload: input.signal.payload,
    },
    signals: [input.signal],
    sideEffects: ["signal.wait"],
    async run(context) {
      const correlation = input.signal.parseCorrelation(input.correlation({
        input: context.input,
      }));
      return context.waitFor(createHook<
        SignalWaitHookInput<InferOperationContractSource<TCorrelation>>,
        SignalWaitValue<InferOperationContractSource<TPayload>>
      >({
        id: input.signal.id,
        kind: "signal",
        schema: input.signal.descriptor,
        title: input.signal.descriptor.title,
      }), {
        contractFingerprint: input.signal.descriptor.contractFingerprint,
        correlation,
        correlationHash: signalCorrelationHash(correlation),
        signalId: input.signal.id,
      }) as Promise<InferStepContractOutput<{
        occurrenceId: z.ZodString;
        occurredAt: z.ZodString;
        payload: TPayload;
      }>>;
    },
  });
}
