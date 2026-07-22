import {
  createContractedRuntimeStep,
  done,
  type CandidateScorePolicy,
  type ContractedStepContext,
  type InferStepContractOutput,
  type QuestionResolverRegistry,
  type StepContractSourceMap,
  type StepDefinition as RuntimeStepDefinition,
  type StepModelOperation,
  type StepResult,
} from "../core/index.js";
import type {
  WorkflowCatalogConfigRequirement,
  WorkflowCatalogCreateInput,
  WorkflowCatalogExample,
  WorkflowCatalogExecution,
  WorkflowCatalogImplementation,
  WorkflowCatalogItem,
  WorkflowCatalogItemKind,
  WorkflowCatalogRuntimeDependency,
} from "../product/catalog/catalog.js";
import type { ModelWorkerSource } from "../product/model/index.js";
import {
  createStepArtifactRegistry,
  type StepArtifactRegistry,
} from "./artifacts.js";
import type { SignalDefinition } from "./signal.js";

type AdvancedStepResult<TOutput> = StepResult<TOutput>;

export type AuthoredStepContext<
  TInputContracts extends StepContractSourceMap | undefined,
  TConfig = Readonly<Record<string, unknown>>,
> = ContractedStepContext<unknown, unknown, TInputContracts> & {
  artifacts: StepArtifactRegistry;
  config: TConfig;
  model?: ModelWorkerSource;
};

export type AuthoredStepConfig<TConfig> = {
  defaults: TConfig;
  resolve?: (
    defaults: TConfig,
    placement: Readonly<Record<string, unknown>>,
  ) => TConfig;
};

export type AuthoredStepInput<
  TInputContracts extends StepContractSourceMap | undefined,
  TOutputContracts extends StepContractSourceMap | undefined,
  TConfig = Readonly<Record<string, unknown>>,
> = {
  capabilities?: string[];
  config?: AuthoredStepConfig<TConfig>;
  configRequirements?: WorkflowCatalogConfigRequirement[];
  description?: string;
  examples?: WorkflowCatalogExample[];
  execution?: WorkflowCatalogExecution;
  id: string;
  implementation?: WorkflowCatalogImplementation;
  input?: TInputContracts;
  intents?: string[];
  kind?: WorkflowCatalogItemKind;
  label?: string;
  maxRetries?: number;
  models?: StepModelOperation[];
  output?: TOutputContracts;
  prompts?: Record<string, string>;
  questionResolvers?: QuestionResolverRegistry;
  run(
    context: AuthoredStepContext<TInputContracts, TConfig>,
  ):
    | InferStepContractOutput<TOutputContracts>
    | AdvancedStepResult<InferStepContractOutput<TOutputContracts>>
    | Promise<
      InferStepContractOutput<TOutputContracts>
      | AdvancedStepResult<InferStepContractOutput<TOutputContracts>>
    >;
  runtimeDependencies?: WorkflowCatalogRuntimeDependency[];
  signals?: readonly SignalDefinition[];
  sideEffects?: string[];
  scorePolicy?: CandidateScorePolicy;
  semantic?: boolean;
  tags?: string[];
  verbs?: string[];
};

export type AuthoredStepDefinition<
  TInputContracts extends StepContractSourceMap | undefined = StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap | undefined = StepContractSourceMap,
> = WorkflowCatalogItem & {
  readonly definitionType: "step";
  create(input?: WorkflowCatalogCreateInput): RuntimeStepDefinition;
  readonly input: TInputContracts;
  readonly output: TOutputContracts;
  readonly questionResolvers?: QuestionResolverRegistry;
  readonly signals?: readonly SignalDefinition[];
};

export type AuthoredStepMetadata<
  TInputContracts extends StepContractSourceMap | undefined,
  TOutputContracts extends StepContractSourceMap | undefined,
> = Omit<AuthoredStepInput<TInputContracts, TOutputContracts>, "config" | "run">;

export function baseStep<
  const TInputContracts extends StepContractSourceMap | undefined = undefined,
  const TOutputContracts extends StepContractSourceMap | undefined = undefined,
  TConfig = Readonly<Record<string, unknown>>,
>(input: AuthoredStepInput<TInputContracts, TOutputContracts, TConfig>): AuthoredStepDefinition<
  TInputContracts,
  TOutputContracts
> {
  return authoredStepDefinition(input, (createInput) => {
    const config = resolveAuthoredStepConfig(input.config, createInput.config);
    return createContractedRuntimeStep<unknown, unknown, TInputContracts, TOutputContracts>({
      description: input.description,
      id: createInput.stepId ?? input.id,
      input: input.input,
      kind: input.kind ?? "step",
      label: input.label,
      maxRetries: input.maxRetries,
      models: input.models,
      output: input.output,
      questionResolvers: input.questionResolvers,
      async run(context) {
        const result = await input.run({
          ...context,
          artifacts: createStepArtifactRegistry(context),
          config,
          model: createInput.model,
        });
        return isAdvancedStepResult(result) ? result : done(result);
      },
    });
  });
}

export function authoredStepDefinition<
  const TInputContracts extends StepContractSourceMap | undefined,
  const TOutputContracts extends StepContractSourceMap | undefined,
>(
  input: AuthoredStepMetadata<TInputContracts, TOutputContracts>,
  create: (input: WorkflowCatalogCreateInput) => RuntimeStepDefinition,
): AuthoredStepDefinition<TInputContracts, TOutputContracts> {
  const definition: AuthoredStepDefinition<
    TInputContracts,
    TOutputContracts
  > = {
    capabilities: input.capabilities,
    configRequirements: input.configRequirements,
    definitionType: "step",
    description: input.description,
    examples: input.examples,
    execution: input.execution,
    id: input.id,
    implementation: input.implementation ?? { kind: "typescript" },
    input: input.input as TInputContracts,
    inputs: input.input,
    intents: input.intents,
    kind: input.kind ?? "step",
    label: input.label ?? input.id,
    output: input.output as TOutputContracts,
    outputs: input.output,
    prompts: input.prompts,
    questionResolvers: input.questionResolvers,
    runtimeDependencies: input.runtimeDependencies,
    signals: input.signals,
    sideEffects: input.sideEffects,
    scorePolicy: input.scorePolicy,
    semantic: input.semantic,
    tags: input.tags,
    verbs: input.verbs,
    create(createInput = {}) {
      return create(createInput);
    },
  };
  return definition;
}

function isAdvancedStepResult<TOutput>(
  value: TOutput | AdvancedStepResult<TOutput>,
): value is AdvancedStepResult<TOutput> {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  return value.type === "ask"
    || value.type === "done"
    || value.type === "fail"
    || value.type === "goto"
    || value.type === "retry"
    || value.type === "wait";
}

export function resolveAuthoredStepConfig<TConfig>(
  config: AuthoredStepConfig<TConfig> | undefined,
  placement: Readonly<Record<string, unknown>> | undefined,
): TConfig {
  const placementConfig = placement ?? {};
  if (!config) return placementConfig as TConfig;
  return config.resolve
    ? config.resolve(config.defaults, placementConfig)
    : Object.assign({}, config.defaults, placementConfig);
}
