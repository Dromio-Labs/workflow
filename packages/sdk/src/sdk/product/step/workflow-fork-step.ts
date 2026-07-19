import {
  createContractedRuntimeStep,
  done,
  type EventPayload,
  type InferStepContractOutput,
  type StepContractSourceMap,
  type StepDefinition,
  type StepOptions,
  type StepRuntimeMetadata,
} from "../../core/index.js";
import {
  runChildWorkflow,
  type ChildWorkflowSession,
  type RunnableChildWorkflow,
} from "../workflow/child-workflow.js";
import type {
  ProductWorkflowStepScope,
} from "./workflow-step.js";
import {
  assertWorkflowIdentity,
  type WorkflowReference,
} from "./workflow-reference.js";

type ForkStepRuntime = StepRuntimeMetadata & {
  emit(event: EventPayload): void;
};

type WorkflowForkRunContext = {
  forkSpanId: string;
  parentStep: ForkStepRuntime;
};

export type WorkflowForkBranch<
  TId extends string = string,
  TResult = unknown,
> = {
  id: TId;
  label: string;
  run(context: WorkflowForkRunContext): Promise<TResult>;
};

export type WorkflowForkResults<
  TBranches extends readonly WorkflowForkBranch[],
> = {
  [TBranch in TBranches[number] as TBranch["id"]]:
    TBranch extends WorkflowForkBranch<string, infer TResult> ? TResult : never;
};

export type WorkflowForkBranchInput<
  TId extends string,
  TChildInput,
  TSession extends ChildWorkflowSession,
  TResult,
> = {
  childInput: TChildInput;
  createWorkflow:
    | RunnableChildWorkflow<TChildInput, TSession>
    | (() => RunnableChildWorkflow<TChildInput, TSession>);
  id: TId;
  label?: string;
  mapResult(session: TSession): Promise<TResult> | TResult;
  workflow: WorkflowReference;
};

export type ProductForkWorkflowStepInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
  TBranches extends readonly WorkflowForkBranch[],
> = Omit<StepOptions, "input" | "kind" | "output"> & {
  branches(scope: ProductWorkflowStepScope<TInputContracts>): TBranches;
  id: string;
  input: TInputContracts;
  join(
    results: WorkflowForkResults<TBranches>,
    scope: ProductWorkflowStepScope<TInputContracts>,
  ): InferStepContractOutput<TOutputContracts> | Promise<InferStepContractOutput<TOutputContracts>>;
  output: TOutputContracts;
};

export class WorkflowForkError extends Error {
  constructor(readonly failures: Array<{ branchId: string; error: unknown }>) {
    super(`Workflow fork failed in ${failures.map((failure) => failure.branchId).join(", ")}.`);
    this.name = "WorkflowForkError";
  }
}

export function createWorkflowForkBranch<
  const TId extends string,
  TChildInput,
  TSession extends ChildWorkflowSession,
  TResult,
>(input: WorkflowForkBranchInput<TId, TChildInput, TSession, TResult>): WorkflowForkBranch<TId, TResult> {
  const label = input.label ?? input.id;
  return {
    id: input.id,
    label,
    async run(context) {
      const startedAt = Date.now();
      const branchSpanId = `${context.forkSpanId}:branch:${input.id}`;
      emitForkEvent(context.parentStep, {
        detail: { branchId: input.id, branchLabel: label },
        message: `Started ${label}.`,
        name: label,
        parentSpanId: context.forkSpanId,
        spanId: branchSpanId,
        status: "unset",
        type: "fork.branch.started",
      });
      try {
        const workflow = typeof input.createWorkflow === "function"
          ? input.createWorkflow()
          : input.createWorkflow;
        assertWorkflowIdentity(input.workflow, workflow);
        const session = await runChildWorkflow({
          childWorkflowId: input.workflow.id,
          emit: context.parentStep.emit,
          input: input.childInput,
          itemId: input.id,
          itemKind: "fork-branch",
          iterationLabel: label,
          messagePrefix: label,
          parentStepId: context.parentStep.id,
          parentTrace: {
            spanId: branchSpanId,
            traceId: context.parentStep.runId,
          },
          phase: "fork branch",
          spanIdPrefix: `${branchSpanId}:child`,
          stepIdPrefix: `${context.parentStep.id}.${input.id}`,
          workflow,
        });
        const result = await input.mapResult(session);
        emitForkEvent(context.parentStep, {
          detail: { branchId: input.id, branchLabel: label, durationMs: Date.now() - startedAt },
          message: `Completed ${label}.`,
          name: label,
          parentSpanId: context.forkSpanId,
          spanId: branchSpanId,
          status: "ok",
          type: "fork.branch.completed",
        });
        return result;
      } catch (error) {
        emitForkEvent(context.parentStep, {
          detail: { branchId: input.id, branchLabel: label, durationMs: Date.now() - startedAt },
          error: errorMessage(error),
          message: `Failed ${label}.`,
          name: label,
          parentSpanId: context.forkSpanId,
          spanId: branchSpanId,
          status: "error",
          type: "fork.branch.failed",
        });
        throw error;
      }
    },
  };
}

export function forkWorkflowStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
  const TBranches extends readonly WorkflowForkBranch[],
>(input: ProductForkWorkflowStepInput<TInputContracts, TOutputContracts, TBranches>): StepDefinition {
  return createContractedRuntimeStep({
    description: input.description,
    id: input.id,
    input: input.input,
    kind: "fork",
    label: input.label,
    maxRetries: input.maxRetries,
    models: input.models,
    output: input.output,
    async run(context) {
      const parentStep: ForkStepRuntime = { ...context.step, emit: context.emit };
      const scope: ProductWorkflowStepScope<TInputContracts> = {
        emit: context.emit,
        input: context.input,
        state: context.state,
        step: context.step,
      };
      const branches = input.branches(scope);
      validateBranches(branches);
      const forkSpanId = `fork:${context.step.id}:attempt:${context.step.attempt}`;
      emitForkEvent(parentStep, {
        detail: { branches: branches.map(branchShape), concurrency: branches.length },
        message: `Forking ${branches.length} branches concurrently.`,
        name: input.label ?? input.id,
        parentSpanId: parentStepSpanId(context.step),
        spanId: forkSpanId,
        status: "unset",
        type: "fork.started",
      });
      const settled = await Promise.allSettled(branches.map((branch) => branch.run({
        forkSpanId,
        parentStep,
      })));
      const failures = settled.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ branchId: branches[index]!.id, error: result.reason }]
          : []
      );
      if (failures.length > 0) {
        emitForkEvent(parentStep, {
          detail: { failedBranchIds: failures.map((failure) => failure.branchId) },
          message: `Fork failed in ${failures.length} branch${failures.length === 1 ? "" : "es"}.`,
          name: input.label ?? input.id,
          parentSpanId: parentStepSpanId(context.step),
          spanId: forkSpanId,
          status: "error",
          type: "fork.failed",
        });
        throw new WorkflowForkError(failures);
      }
      emitForkEvent(parentStep, {
        detail: { branches: branches.map(branchShape) },
        message: `Completed ${branches.length} fork branches.`,
        name: input.label ?? input.id,
        parentSpanId: parentStepSpanId(context.step),
        spanId: forkSpanId,
        status: "ok",
        type: "fork.completed",
      });
      const results = forkResults(branches, settled);
      const joinSpanId = `${forkSpanId}:join`;
      emitForkEvent(parentStep, {
        detail: { branchIds: branches.map((branch) => branch.id) },
        message: `Joining ${branches.length} branch results.`,
        name: `Join ${input.label ?? input.id}`,
        parentSpanId: forkSpanId,
        spanId: joinSpanId,
        status: "unset",
        type: "join.started",
      });
      const output = await input.join(results, scope);
      emitForkEvent(parentStep, {
        detail: { branchIds: branches.map((branch) => branch.id) },
        message: `Joined ${branches.length} branch results.`,
        name: `Join ${input.label ?? input.id}`,
        parentSpanId: forkSpanId,
        spanId: joinSpanId,
        status: "ok",
        type: "join.completed",
      });
      return done(output);
    },
  });
}

type ForkEventInput = {
  detail: Record<string, unknown>;
  error?: string;
  message: string;
  name: string;
  parentSpanId: string;
  spanId: string;
  status: "error" | "ok" | "unset";
  type: string;
};

function emitForkEvent(step: ForkStepRuntime, input: ForkEventInput) {
  step.emit({
    detail: input.detail,
    error: input.error,
    message: input.message,
    stepId: step.id,
    trace: {
      attributes: { phase: input.type.startsWith("join.") ? "join" : "fork", stepId: step.id },
      kind: "internal",
      name: input.name,
      parentSpanId: input.parentSpanId,
      spanId: input.spanId,
      status: input.status,
      traceId: step.runId,
    },
    type: input.type,
  });
}

function forkResults<TBranches extends readonly WorkflowForkBranch[]>(
  branches: TBranches,
  settled: PromiseSettledResult<unknown>[],
): WorkflowForkResults<TBranches> {
  const results: Record<string, unknown> = {};
  for (const [index, branch] of branches.entries()) {
    const result = settled[index];
    if (result?.status === "fulfilled") results[branch.id] = result.value;
  }
  return results as WorkflowForkResults<TBranches>;
}

function validateBranches(branches: readonly WorkflowForkBranch[]) {
  if (branches.length < 2) throw new Error("fork workflow step requires at least two branches.");
  const ids = branches.map((branch) => branch.id);
  if (new Set(ids).size !== ids.length) throw new Error("fork workflow step requires unique branch ids.");
}

function branchShape(branch: WorkflowForkBranch) {
  return { id: branch.id, label: branch.label };
}

function parentStepSpanId(step: StepRuntimeMetadata) {
  return `step:${step.id}:attempt:${step.attempt}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
