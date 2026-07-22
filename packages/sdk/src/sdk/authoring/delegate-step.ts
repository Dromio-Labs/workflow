import type { JsonObject, JsonValue } from "@dromio/workflow-room-protocol";
import {
  createHook,
  jsonSchemaFromContractSource,
  type InferStepContractInput,
  type InferStepContractOutput,
  type StepContractSourceMap,
  type WorkflowRunArtifactRef,
} from "../core/index.js";
import {
  baseStep,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";

type DelegateInputContext<TInputContracts extends StepContractSourceMap> = {
  input: InferStepContractInput<TInputContracts>;
};

export type DelegateValueSource<
  TInputContracts extends StepContractSourceMap,
  TValue,
> = TValue | ((context: DelegateInputContext<TInputContracts>) => TValue);

export type DelegateHandoffInput = {
  artifacts?: WorkflowRunArtifactRef[];
  attempt: number;
  capabilities: string[];
  capabilityRequirements: {
    preferred: string[];
    required: string[];
  };
  context?: JsonValue;
  instructions: string;
  outputSchema: JsonObject;
  runId: string;
  stepId: string;
  summary?: string;
  title?: string;
  workflowId: string;
};

export type DelegateCapabilities = string[] | {
  preferred?: readonly string[];
  required?: readonly string[];
};

export type AuthoredDelegateStepInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
> = Omit<
  AuthoredStepInput<TInputContracts, TOutputContracts>,
  "capabilities" | "implementation" | "kind" | "models" | "prompts" | "run" | "sideEffects"
> & {
  artifacts?: DelegateValueSource<TInputContracts, WorkflowRunArtifactRef[]>;
  capabilities?: DelegateCapabilities;
  context?: DelegateValueSource<TInputContracts, JsonValue>;
  instructions: DelegateValueSource<TInputContracts, string>;
  output: TOutputContracts;
  summary?: DelegateValueSource<TInputContracts, string>;
  title?: DelegateValueSource<TInputContracts, string>;
};

/** Defines durable, provider-neutral work performed by an external harness. */
export function delegateStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
>(
  input: AuthoredDelegateStepInput<TInputContracts, TOutputContracts>,
): AuthoredStepDefinition<TInputContracts, TOutputContracts> {
  const outputSchema = delegateOutputSchema(input.id, input.output);
  const capabilityRequirements = normalizeCapabilities(input.capabilities);
  return baseStep({
    ...input,
    capabilities: [...new Set([
      ...capabilityRequirements.required,
      ...capabilityRequirements.preferred,
    ])],
    implementation: { kind: "primitive" },
    kind: "delegate",
    sideEffects: ["external.harness.delegation"],
    async run(context) {
      const resolutionContext = { input: context.input };
      const instructions = resolve(input.instructions, resolutionContext).trim();
      if (!instructions) {
        throw new Error(`Delegated step ${input.id} requires non-empty instructions.`);
      }
      const title = optionalText(resolveOptional(input.title, resolutionContext));
      const summary = optionalText(resolveOptional(input.summary, resolutionContext));
      const selectedContext = resolveOptional(input.context, resolutionContext);
      const artifacts = resolveOptional(input.artifacts, resolutionContext);
      const handoff: DelegateHandoffInput = {
        ...(artifacts?.length ? { artifacts } : {}),
        attempt: context.step.attempt,
        capabilities: [...new Set([
          ...capabilityRequirements.required,
          ...capabilityRequirements.preferred,
        ])],
        capabilityRequirements,
        ...(selectedContext !== undefined ? { context: selectedContext } : {}),
        instructions,
        outputSchema,
        runId: context.step.runId,
        stepId: context.step.id,
        ...(summary ? { summary } : {}),
        ...(title ? { title } : {}),
        workflowId: context.step.workflowId,
      };
      return context.waitFor(createHook<
        DelegateHandoffInput,
        InferStepContractOutput<TOutputContracts>
      >({
        id: input.id,
        kind: "handoff_requested",
        schema: outputSchema,
        title: title ?? input.label,
      }), handoff);
    },
  });
}

function normalizeCapabilities(
  value: DelegateCapabilities | undefined,
) {
  if (Array.isArray(value)) {
    return { preferred: [...new Set(value)], required: [] };
  }
  return {
    preferred: [...new Set(value?.preferred ?? [])],
    required: [...new Set(value?.required ?? [])],
  };
}

function delegateOutputSchema(
  stepId: string,
  contracts: StepContractSourceMap,
): JsonObject {
  const properties: Record<string, JsonValue> = {};
  for (const [key, contract] of Object.entries(contracts)) {
    const schema = jsonSchemaFromContractSource(contract);
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      throw new Error(
        `Delegated step ${stepId} output contract '${key}' must expose a JSON schema.`,
      );
    }
    properties[key] = schema as JsonObject;
  }
  return {
    additionalProperties: false,
    properties,
    required: Object.keys(contracts),
    type: "object",
  };
}

function resolve<TInputContracts extends StepContractSourceMap, TValue>(
  source: DelegateValueSource<TInputContracts, TValue>,
  context: DelegateInputContext<TInputContracts>,
): TValue {
  return typeof source === "function"
    ? (source as (context: DelegateInputContext<TInputContracts>) => TValue)(context)
    : source;
}

function resolveOptional<TInputContracts extends StepContractSourceMap, TValue>(
  source: DelegateValueSource<TInputContracts, TValue> | undefined,
  context: DelegateInputContext<TInputContracts>,
): TValue | undefined {
  return source === undefined ? undefined : resolve(source, context);
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}
