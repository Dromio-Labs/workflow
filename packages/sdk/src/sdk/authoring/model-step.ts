import {
  jsonSchemaFromContractSource,
  normalizeOperationContract,
  parseJsonObjectFromText,
  parseOperationContract,
  type InferStepContractInput,
  type InferStepContractOutput,
  type StepContractSourceMap,
} from "../core/index.js";
import {
  describeModelWorkerSource,
  resolveModelWorkerSource,
  type ModelWorkerSource,
} from "../product/model/index.js";
import {
  describePromptSource,
  readPromptSource,
  type PromptSource,
} from "../product/prompts/index.js";
import {
  baseStep,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";

export type AuthoredModelStepInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
> = Omit<
  AuthoredStepInput<TInputContracts, TOutputContracts>,
  "implementation" | "input" | "kind" | "models" | "output" | "run"
> & {
  buildPrompt?(input: InferStepContractInput<TInputContracts>): string | unknown;
  model?: ModelWorkerSource;
  operation?: string;
  input: TInputContracts;
  output: TOutputContracts;
  prompt: PromptSource;
};

export function modelStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
>(input: AuthoredModelStepInput<TInputContracts, TOutputContracts>): AuthoredStepDefinition<
  TInputContracts,
  TOutputContracts
> {
  const operation = input.operation ?? input.id;
  const requested = describeModelWorkerSource(input.model);
  return baseStep({
    ...input,
    implementation: { kind: "typescript" },
    kind: "model",
    models: [{
      operation,
      prompt: describePromptSource(input.prompt),
      requested: requested
        ? {
            capabilities: requested.capabilities,
            id: requested.id,
            label: requested.label,
            model: requested.model,
            worker: requested.worker,
          }
        : undefined,
    }],
    async run(context) {
      const resolution = await resolveModelWorkerSource(context.model ?? input.model, {
        context,
        onEvent: context.emit,
        parentSpanId: `step:${context.step.id}:attempt:${context.step.attempt}`,
        target: {
          operation,
          runId: context.step.runId,
          stepId: context.step.id,
          workflowId: context.step.workflowId,
        },
        traceId: context.step.runId,
      });
      const raw = await resolution.worker.complete({
        jsonSchema: outputJsonSchema(input.output),
        onEvent: context.emit,
        operation: input.label ?? input.id,
        systemPrompt: (await readPromptSource(input.prompt)).trim(),
        trace: {
          parentSpanId: `step:${context.step.id}:attempt:${context.step.attempt}`,
          spanId: `model:${context.step.id}:attempt:${context.step.attempt}`,
          traceId: context.step.runId,
        },
        userPrompt: renderPrompt(input.buildPrompt?.(context.input) ?? context.input),
      });
      return parseModelOutput(
        input.id,
        input.output,
        parseJsonObjectFromText(raw, `${input.id} model response`),
      );
    },
  });
}

function parseModelOutput<TContracts extends StepContractSourceMap>(
  stepId: string,
  contracts: TContracts,
  value: unknown,
): InferStepContractOutput<TContracts> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${stepId} model response must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(contracts).map(([key, contract]) => [
      key,
      parseOperationContract(
        normalizeOperationContract(`${stepId}.output.${key}`, contract),
        record[key],
      ),
    ]),
  ) as InferStepContractOutput<TContracts>;
}

function outputJsonSchema(contracts: StepContractSourceMap) {
  return {
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(contracts).map(([key, contract]) => [
        key,
        jsonSchemaFromContractSource(contract),
      ]),
    ),
    required: Object.keys(contracts),
    type: "object",
  };
}

function renderPrompt(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
