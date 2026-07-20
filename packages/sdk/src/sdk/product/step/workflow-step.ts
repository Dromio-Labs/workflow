import {
  createContractedRuntimeStep,
  done,
  wait,
  type EventPayload,
  type InferStepContractInput,
  type InferStepContractOutput,
  type StepContractSourceMap,
  type StepDefinition,
  type StepOptions,
  type StepRuntimeMetadata,
  type StepState,
} from "../../core/index.js";
import {
  driveChildWorkflow,
  FailedChildWorkflowError,
  memoizedChildWorkflowCompletion,
  type ChildWorkflowCompletedContext,
  type ChildWorkflowFailedContext,
  type ChildWorkflowIterationContext,
  type ChildWorkflowIterationResult,
  type ChildWorkflowSession,
  type RunnableChildWorkflow,
} from "../workflow/child-workflow.js";
import {
  assertWorkflowIdentity,
  type WorkflowReference,
} from "./workflow-reference.js";

export type ProductWorkflowStepScope<TInputContracts extends StepContractSourceMap> = {
  emit: (event: EventPayload) => void;
  input: InferStepContractInput<TInputContracts>;
  state: StepState;
  step: StepRuntimeMetadata;
};

export type ProductWorkflowStepInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
  TChildInput,
  TSession extends ChildWorkflowSession,
> = Omit<StepOptions, "input" | "kind" | "output"> & {
  childInput(scope: ProductWorkflowStepScope<TInputContracts>): TChildInput;
  createWorkflow:
    | RunnableChildWorkflow<TChildInput, TSession>
    | ((scope: ProductWorkflowStepScope<TInputContracts>) => RunnableChildWorkflow<TChildInput, TSession>);
  id: string;
  input: TInputContracts;
  mapOutput(
    session: TSession,
    scope: ProductWorkflowStepScope<TInputContracts>,
  ): InferStepContractOutput<TOutputContracts> | Promise<InferStepContractOutput<TOutputContracts>>;
  output: TOutputContracts;
  phase?: string;
  workflow: WorkflowReference;
};

export type ProductForEachWorkflowStepScope<
  TInputContracts extends StepContractSourceMap,
  TItem,
  TPrepared,
> = ProductWorkflowStepScope<TInputContracts> & ChildWorkflowIterationContext<TItem> & {
  prepared: TPrepared;
};

export type ProductForEachWorkflowPreparedScope<
  TInputContracts extends StepContractSourceMap,
  TPrepared,
> = ProductWorkflowStepScope<TInputContracts> & {
  prepared: TPrepared;
};

export type ProductForEachWorkflowStepInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
  TItem,
  TChildInput,
  TSession extends ChildWorkflowSession,
  TPrepared = undefined,
> = Omit<StepOptions, "input" | "kind" | "output"> & {
  childInput(item: TItem, scope: ProductForEachWorkflowStepScope<TInputContracts, TItem, TPrepared>): TChildInput;
  collect(
    results: Array<ChildWorkflowIterationResult<TItem, TSession>>,
    scope: ProductForEachWorkflowPreparedScope<TInputContracts, TPrepared>,
  ): InferStepContractOutput<TOutputContracts> | Promise<InferStepContractOutput<TOutputContracts>>;
  continueOnError?: boolean;
  id: string;
  input: TInputContracts;
  itemId?(item: TItem, scope: ProductForEachWorkflowStepScope<TInputContracts, TItem, TPrepared>): string;
  itemKind?: string;
  itemLabel?(item: TItem, scope: ProductForEachWorkflowStepScope<TInputContracts, TItem, TPrepared>): string;
  items(scope: ProductForEachWorkflowPreparedScope<TInputContracts, TPrepared>): readonly TItem[];
  onItemCompleted?(
    scope: ProductForEachWorkflowPreparedScope<TInputContracts, TPrepared>
      & ChildWorkflowCompletedContext<TItem, TSession>,
  ): Promise<void> | void;
  onItemFailed?(
    scope: ProductForEachWorkflowPreparedScope<TInputContracts, TPrepared>
      & ChildWorkflowFailedContext<TItem, TSession>,
  ): Promise<void> | void;
  onItemStarted?(
    scope: ProductForEachWorkflowStepScope<TInputContracts, TItem, TPrepared>,
  ): Promise<void> | void;
  output: TOutputContracts;
  phase?: string;
  prepare?(
    scope: ProductWorkflowStepScope<TInputContracts>,
  ): Promise<TPrepared> | TPrepared;
  createWorkflow(
    item: TItem,
    scope: ProductForEachWorkflowStepScope<TInputContracts, TItem, TPrepared>,
  ): RunnableChildWorkflow<TChildInput, TSession>;
  workflow: WorkflowReference;
};

export function workflowStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
  TChildInput,
  TSession extends ChildWorkflowSession,
>(input: ProductWorkflowStepInput<TInputContracts, TOutputContracts, TChildInput, TSession>) {
  const childSessions = new Map<string, ChildWorkflowSession>();
  return createContractedRuntimeStep({
    description: input.description,
    id: input.id,
    input: input.input,
    kind: "workflow",
    label: input.label,
    maxRetries: input.maxRetries,
    models: input.models,
    output: input.output,
    async run(context) {
      const scope = workflowScope<TInputContracts>(context);
      const childWorkflow = typeof input.createWorkflow === "function"
        ? input.createWorkflow(scope)
        : input.createWorkflow;
      assertWorkflowIdentity(input.workflow, childWorkflow);
      const outcome = await driveChildWorkflow<TChildInput, TSession>({
        childWorkflowId: input.workflow.id,
        context: {
          answers: context.answers,
          hookAnswers: context.hookAnswers,
          state: context.state,
          step: context.step,
        },
        emit: context.emit,
        input: input.childInput(scope),
        namespace: context.step.id,
        parentStepId: context.step.id,
        parentTrace: parentStepTrace(context.step),
        phase: input.phase ?? "child workflow",
        sessions: childSessions,
        spanIdPrefix: `child:${context.step.id}`,
        stepIdPrefix: context.step.id,
        workflow: childWorkflow,
      });
      if (outcome.status === "waiting") {
        return wait({ hooks: outcome.hooks, questions: outcome.questions });
      }
      return done(await input.mapOutput(outcome.session, scope));
    },
  });
}

export function forEachWorkflowStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
  TItem,
  TChildInput,
  TSession extends ChildWorkflowSession,
  TPrepared,
>(input: ProductForEachWorkflowStepInput<
  TInputContracts,
  TOutputContracts,
  TItem,
  TChildInput,
  TSession,
  TPrepared
> & {
  prepare(scope: ProductWorkflowStepScope<TInputContracts>): Promise<TPrepared> | TPrepared;
}): StepDefinition;

export function forEachWorkflowStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
  TItem,
  TChildInput,
  TSession extends ChildWorkflowSession,
>(input: ProductForEachWorkflowStepInput<
  TInputContracts,
  TOutputContracts,
  TItem,
  TChildInput,
  TSession,
  undefined
> & {
  prepare?: undefined;
}): StepDefinition;

export function forEachWorkflowStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
  TItem,
  TChildInput,
  TSession extends ChildWorkflowSession,
  TPrepared,
>(input: ProductForEachWorkflowStepInput<
  TInputContracts,
  TOutputContracts,
  TItem,
  TChildInput,
  TSession,
  TPrepared
>) {
  const childSessions = new Map<string, ChildWorkflowSession>();
  return createContractedRuntimeStep({
    description: input.description,
    id: input.id,
    input: input.input,
    kind: "workflow",
    label: input.label,
    maxRetries: input.maxRetries,
    models: input.models,
    output: input.output,
    async run(context) {
      const baseScope = workflowScope<TInputContracts>(context);
      const parentScope = {
        ...baseScope,
        prepared: input.prepare
          ? await input.prepare(baseScope)
          : undefined as TPrepared,
      };
      const items = input.items(parentScope);
      const results: Array<ChildWorkflowIterationResult<TItem, TSession>> = [];
      const total = items.length;
      for (const [index, item] of items.entries()) {
        const seed = { index, item, itemId: "", itemLabel: "", total };
        const itemId = input.itemId
          ? input.itemId(item, { ...parentScope, ...seed })
          : String(index);
        const labelSeed = { ...seed, itemId };
        const itemLabel = input.itemLabel
          ? input.itemLabel(item, { ...parentScope, ...labelSeed })
          : itemId;
        const iteration = { index, item, itemId, itemLabel, total };
        const namespace = `${context.step.id}.${itemId}`;
        const memo = memoizedChildWorkflowCompletion(context.state, namespace);
        if (memo) {
          results.push({ ...iteration, session: memo as unknown as TSession, status: "completed" });
          continue;
        }
        try {
          const childWorkflow = input.createWorkflow(item, { ...parentScope, ...iteration });
          assertWorkflowIdentity(input.workflow, childWorkflow);
          await input.onItemStarted?.({ ...parentScope, ...iteration });
          const outcome = await driveChildWorkflow<TChildInput, TSession>({
            childWorkflowId: input.workflow.id,
            context: {
              answers: context.answers,
              hookAnswers: context.hookAnswers,
              state: context.state,
              step: context.step,
            },
            detail: { itemId, itemKind: input.itemKind },
            emit: context.emit,
            input: input.childInput(item, { ...parentScope, ...iteration }),
            itemId,
            itemKind: input.itemKind,
            iterationIndex: index,
            iterationLabel: itemLabel,
            iterationTotal: total,
            messagePrefix: itemLabel,
            namespace,
            parentStepId: context.step.id,
            parentTrace: parentStepTrace(context.step),
            phase: input.phase ?? "child workflow",
            retainCompleted: true,
            sessions: childSessions,
            spanIdPrefix: [
              "child",
              context.step.id,
              input.itemKind ? `${input.itemKind}:${itemId}` : itemId,
            ].join(":"),
            stepIdPrefix: [context.step.id, itemId].join("."),
            workflow: childWorkflow,
          });
          if (outcome.status === "waiting") {
            return wait({ hooks: outcome.hooks, questions: outcome.questions });
          }
          const completed = { ...iteration, session: outcome.session, status: "completed" as const };
          await input.onItemCompleted?.({ ...parentScope, ...completed });
          results.push(completed);
        } catch (error) {
          const session = error instanceof FailedChildWorkflowError
            ? error.session as TSession | undefined
            : undefined;
          const failed = { ...iteration, error, session, status: "failed" as const };
          results.push(failed);
          await input.onItemFailed?.({ ...parentScope, ...failed });
          if (!input.continueOnError) throw error;
        }
      }
      return done(await input.collect(results, parentScope));
    },
  });
}

function parentStepTrace(step: StepRuntimeMetadata) {
  return {
    spanId: `step:${step.id}:attempt:${step.attempt}`,
    traceId: step.runId,
  };
}

function workflowScope<TInputContracts extends StepContractSourceMap>(context: {
  emit: (event: EventPayload) => void;
  input: InferStepContractInput<TInputContracts>;
  state: StepState;
  step: StepRuntimeMetadata;
}): ProductWorkflowStepScope<TInputContracts> {
  return {
    emit: context.emit,
    input: context.input,
    state: context.state,
    step: context.step,
  };
}
