import {
  defineOperationContract,
  jsonSchemaFromContractSource,
  normalizeOperationContract,
  parseOperationContract,
  type EventPayload,
  type InferStepContractInput,
  type InferStepContractOutput,
  type InferOperationContractSource,
  type OperationContract,
  type OperationContractSourceLike,
  type StepContractSourceMap,
  type StepRuntimeMetadata,
  type StepState,
} from "../core/index.js";
import { forEachWorkflowStep } from "../product/step/workflow-step.js";
import type {
  ChildWorkflowIterationResult,
  ChildWorkflowSession,
} from "../product/workflow/child-workflow.js";
import {
  authoredStepDefinition,
  resolveAuthoredStepConfig,
  type AuthoredStepConfig,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";
import type { AuthoredWorkflow } from "./workflow.js";

type ContractValue<TContracts extends StepContractSourceMap> =
  InferOperationContractSource<TContracts[keyof TContracts]>;

type UnknownContracts = Record<string, OperationContract<unknown>>;
type UnknownSimpleInput = AuthoredForEachStepInput<string, string, UnknownContracts, UnknownContracts>;
type UnknownAdvancedInput = AuthoredAdvancedForEachStepInput<
  UnknownContracts,
  UnknownContracts,
  UnknownContracts,
  UnknownContracts,
  unknown,
  (scope: AdvancedForEachPrepareScope<UnknownContracts, unknown>) => unknown,
  unknown,
  Readonly<Record<string, unknown>>
>;
type InternalPrepared = {
  prepared: unknown;
  workflow: ReturnType<AuthoredWorkflow["configure"]>;
};
type Prepared<TPrepare> = TPrepare extends (...args: never[]) => infer TResult
  ? Awaited<TResult>
  : never;

export type ForEachInputContracts<
  TItems extends string,
  TChildInputContracts extends StepContractSourceMap,
> = Record<TItems, OperationContract<Array<ContractValue<TChildInputContracts>>>>;

export type ForEachOutputContracts<
  TCollect extends string,
  TChildOutputContracts extends StepContractSourceMap,
> = Record<TCollect, OperationContract<Array<ContractValue<TChildOutputContracts>>>>;

export type AuthoredForEachStepInput<
  TItems extends string,
  TCollect extends string,
  TChildInputContracts extends StepContractSourceMap,
  TChildOutputContracts extends StepContractSourceMap,
> = {
  collect: TCollect;
  description?: string;
  id: string;
  items: TItems;
  label?: string;
  maxRetries?: number;
  workflow: AuthoredWorkflow<TChildInputContracts, TChildOutputContracts>;
};

export type AdvancedForEachScope<
  TInputContracts extends StepContractSourceMap,
  TConfig,
  TPrepared,
> = {
  config: TConfig;
  emit: (event: EventPayload) => void;
  input: InferStepContractInput<TInputContracts>;
  prepared: TPrepared;
  state: StepState;
  step: StepRuntimeMetadata;
};

export type AdvancedForEachPrepareScope<
  TInputContracts extends StepContractSourceMap,
  TConfig,
> = Omit<AdvancedForEachScope<TInputContracts, TConfig, never>, "prepared">;

export type AdvancedForEachIterationScope<
  TInputContracts extends StepContractSourceMap,
  TConfig,
  TPrepared,
  TItem,
> = AdvancedForEachScope<TInputContracts, TConfig, TPrepared> & {
  index: number;
  item: TItem;
  itemId: string;
  itemLabel: string;
  total: number;
};

export type AdvancedForEachResult<TItem, TOutput> =
  | ({ status: "completed"; output: TOutput } & IterationMetadata<TItem>)
  | ({ status: "failed"; error: unknown } & IterationMetadata<TItem>);

type IterationMetadata<TItem> = {
  index: number;
  item: TItem;
  itemId: string;
  itemLabel: string;
  total: number;
};

export type AuthoredAdvancedForEachStepInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
  TChildInputContracts extends StepContractSourceMap,
  TChildOutputContracts extends StepContractSourceMap,
  TItem,
  TPrepare,
  TConfig,
  TWorkflowConfig extends object,
> = Omit<
  AuthoredStepInput<TInputContracts, TOutputContracts, TConfig>,
  "execution" | "implementation" | "kind" | "run"
> & {
  childInput(
    item: TItem,
    scope: AdvancedForEachIterationScope<TInputContracts, TConfig, Prepared<TPrepare>, TItem>,
  ): InferStepContractInput<TChildInputContracts>;
  collect(
    results: Array<AdvancedForEachResult<TItem, InferStepContractOutput<TChildOutputContracts>>>,
    scope: AdvancedForEachScope<TInputContracts, TConfig, Prepared<TPrepare>>,
  ): InferStepContractOutput<TOutputContracts> | Promise<InferStepContractOutput<TOutputContracts>>;
  continueOnError?: boolean;
  input: TInputContracts;
  itemLabelPath?: string;
  itemId?(
    item: TItem,
    scope: AdvancedForEachIterationScope<TInputContracts, TConfig, Prepared<TPrepare>, TItem>,
  ): string;
  itemKind?: string;
  itemLabel?(
    item: TItem,
    scope: AdvancedForEachIterationScope<TInputContracts, TConfig, Prepared<TPrepare>, TItem>,
  ): string;
  itemSource?: string;
  iterationLabel?: string;
  items(scope: AdvancedForEachScope<TInputContracts, TConfig, Prepared<TPrepare>>): readonly TItem[];
  onItemCompleted?(
    scope: AdvancedForEachIterationScope<TInputContracts, TConfig, Prepared<TPrepare>, TItem> & {
      output: InferStepContractOutput<TChildOutputContracts>;
    },
  ): Promise<void> | void;
  onItemFailed?(
    scope: AdvancedForEachIterationScope<TInputContracts, TConfig, Prepared<TPrepare>, TItem> & { error: unknown },
  ): Promise<void> | void;
  onItemStarted?(
    scope: AdvancedForEachIterationScope<TInputContracts, TConfig, Prepared<TPrepare>, TItem>,
  ): Promise<void> | void;
  prepare: TPrepare & ((scope: AdvancedForEachPrepareScope<TInputContracts, TConfig>) => unknown);
  output: TOutputContracts;
  workflow: AuthoredWorkflow<TChildInputContracts, TChildOutputContracts, TWorkflowConfig>;
  workflowConfig?(
    scope: AdvancedForEachScope<TInputContracts, TConfig, Prepared<TPrepare>>,
  ): TWorkflowConfig;
};

export function forEachStep<
  const TItems extends string,
  const TCollect extends string,
  const TChildInputContracts extends StepContractSourceMap,
  const TChildOutputContracts extends StepContractSourceMap,
>(input: AuthoredForEachStepInput<TItems, TCollect, TChildInputContracts, TChildOutputContracts>):
  AuthoredStepDefinition<
    ForEachInputContracts<TItems, TChildInputContracts>,
    ForEachOutputContracts<TCollect, TChildOutputContracts>
  >;

export function forEachStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
  const TChildInputContracts extends StepContractSourceMap,
  const TChildOutputContracts extends StepContractSourceMap,
  TItem,
  TPrepare,
  TConfig = Readonly<Record<string, unknown>>,
  TWorkflowConfig extends object = Readonly<Record<string, unknown>>,
>(input: AuthoredAdvancedForEachStepInput<
  TInputContracts,
  TOutputContracts,
  TChildInputContracts,
  TChildOutputContracts,
  TItem,
  TPrepare,
  TConfig,
  TWorkflowConfig
>): AuthoredStepDefinition<TInputContracts, TOutputContracts>;

export function forEachStep(input: object): AuthoredStepDefinition {
  return isAdvancedInput(input)
    ? advancedForEachStep(input)
    : simpleForEachStep(input as UnknownSimpleInput);
}

function isAdvancedInput(input: object): input is UnknownAdvancedInput {
  return "items" in input && typeof input.items === "function";
}

function simpleForEachStep(input: UnknownSimpleInput) {
  const [childInputKey, childInputContract] = singleContract(input.workflow.input, `${input.id} child workflow input`);
  const [childOutputKey, childOutputContract] = singleContract(input.workflow.output, `${input.id} child workflow output`);
  const inputContracts = { [input.items]: arrayContract(`${input.id}.input.${input.items}`, childInputContract) };
  const outputContracts = { [input.collect]: arrayContract(`${input.id}.output.${input.collect}`, childOutputContract) };
  return authoredStepDefinition({
    description: input.description,
    execution: workflowExecution(input.workflow, input.items, input.label),
    id: input.id,
    implementation: workflowImplementation(input.workflow),
    input: inputContracts,
    kind: "composite",
    label: input.label,
    maxRetries: input.maxRetries,
    output: outputContracts,
  }, (createInput) => forEachWorkflowStep({
    childInput: (item) => ({ [childInputKey]: item }),
    collect: (results): Record<string, unknown[]> => ({
      [input.collect]: results.map((result) => {
        if (result.status !== "completed") throw result.error;
        return result.session.state[childOutputKey];
      }),
    }),
    createWorkflow: () => input.workflow,
    id: createInput.stepId ?? input.id,
    input: inputContracts,
    itemId: (_item, context) => String(context.index + 1),
    itemKind: "workflow-item",
    items: ({ input: stepInput }) => stepInput[input.items] as unknown[],
    label: input.label,
    maxRetries: input.maxRetries,
    output: outputContracts,
    workflow: { documentId: input.workflow.document.id, id: input.workflow.id },
  }));
}

function advancedForEachStep(input: UnknownAdvancedInput) {
  return authoredStepDefinition({
    ...input,
    execution: workflowExecution(
      input.workflow,
      input.itemSource,
      input.iterationLabel ?? input.label,
      input.itemLabelPath,
    ),
    implementation: workflowImplementation(input.workflow),
    kind: "composite",
  }, (createInput) => {
    const config = resolveAuthoredStepConfig(
      input.config as AuthoredStepConfig<unknown> | undefined,
      createInput.config,
    );
    return forEachWorkflowStep<
      UnknownContracts,
      UnknownContracts,
      unknown,
      Record<string, unknown>,
      ChildWorkflowSession,
      InternalPrepared
    >({
      childInput: (item, scope) => input.childInput(item, publicIterationScope(scope, config)),
      collect: (results, scope) => input.collect(
        results.map((result) => publicResult(result, input.workflow)),
        publicScope(scope, config),
      ),
      continueOnError: input.continueOnError,
      createWorkflow: (_item, scope) => scope.prepared.workflow,
      id: createInput.stepId ?? input.id,
      input: input.input,
      itemId: input.itemId
        ? (item, scope) => input.itemId!(item, publicIterationScope(scope, config))
        : undefined,
      itemKind: input.itemKind,
      itemLabel: input.itemLabel
        ? (item, scope) => input.itemLabel!(item, publicIterationScope(scope, config))
        : undefined,
      items: (scope) => input.items(publicScope(scope, config)),
      label: input.label,
      maxRetries: input.maxRetries,
      onItemCompleted: input.onItemCompleted
        ? (scope) => input.onItemCompleted!({
          ...publicIterationScope(scope, config),
          output: workflowOutput(input.workflow, scope.session.state),
        })
        : undefined,
      onItemFailed: input.onItemFailed
        ? (scope) => input.onItemFailed!({
          ...publicIterationScope(scope, config),
          error: scope.error,
        })
        : undefined,
      onItemStarted: input.onItemStarted
        ? (scope) => input.onItemStarted!(publicIterationScope(scope, config))
        : undefined,
      output: input.output,
      async prepare(scope) {
        const prepared = await input.prepare({ ...scope, config });
        const publicPreparedScope = { ...scope, config, prepared };
        const workflowConfig = input.workflowConfig?.(publicPreparedScope) ?? {};
        return {
          prepared,
          workflow: input.workflow.configure(workflowConfig),
        };
      },
      workflow: { documentId: input.workflow.document.id, id: input.workflow.id },
    });
  });
}

function publicScope(scope: {
  emit: (event: EventPayload) => void;
  input: Record<string, unknown>;
  prepared: InternalPrepared;
  state: StepState;
  step: StepRuntimeMetadata;
}, config: unknown) {
  return { ...scope, config, prepared: scope.prepared.prepared };
}

function publicIterationScope(scope: Parameters<typeof publicScope>[0] & IterationMetadata<unknown>, config: unknown) {
  return { ...publicScope(scope, config), ...iterationMetadata(scope) };
}

function publicResult(
  result: ChildWorkflowIterationResult<unknown, ChildWorkflowSession>,
  workflow: AuthoredWorkflow,
): AdvancedForEachResult<unknown, Record<string, unknown>> {
  const metadata = iterationMetadata(result);
  return result.status === "completed"
    ? { ...metadata, output: workflowOutput(workflow, result.session.state), status: "completed" }
    : { ...metadata, error: result.error, status: "failed" };
}

function workflowOutput(workflow: AuthoredWorkflow, state: StepState): Record<string, unknown> {
  return Object.fromEntries(Object.entries(workflow.output).map(([key, contract]) => [
    key,
    parseOperationContract(normalizeOperationContract(`${workflow.id}.output.${key}`, contract), state[key]),
  ]));
}

function iterationMetadata<TItem>(scope: IterationMetadata<TItem>): IterationMetadata<TItem> {
  return {
    index: scope.index,
    item: scope.item,
    itemId: scope.itemId,
    itemLabel: scope.itemLabel,
    total: scope.total,
  };
}

function workflowExecution(
  workflow: AuthoredWorkflow,
  itemSource?: string,
  label?: string,
  itemLabelPath?: string,
) {
  return {
    childWorkflowDocumentId: workflow.document.id,
    itemLabelPath,
    itemSource,
    kind: "forEach" as const,
    label,
  };
}

function workflowImplementation(workflow: AuthoredWorkflow) {
  return {
    children: workflow.document.nodes.map((node) => node.catalogItemId),
    kind: "composite" as const,
    workflowDocumentId: workflow.document.id,
  };
}

function arrayContract<TSource extends OperationContractSourceLike>(id: string, itemContract: TSource):
  OperationContract<Array<InferOperationContractSource<TSource>>> {
  const normalized = normalizeOperationContract(`${id}.item`, itemContract);
  return defineOperationContract({
    id,
    jsonSchema: { items: jsonSchemaFromContractSource(itemContract), type: "array" },
    parse(value) {
      if (!Array.isArray(value)) throw new Error(`${id} must be an array.`);
      return value.map((item) => parseOperationContract(normalized, item));
    },
  });
}

function singleContract<TContracts extends StepContractSourceMap>(contracts: TContracts, label: string):
  [string, TContracts[keyof TContracts]] {
  const entries = Object.entries(contracts);
  if (entries.length !== 1) throw new Error(`step.forEach requires exactly one ${label} contract.`);
  return entries[0] as [string, TContracts[keyof TContracts]];
}
