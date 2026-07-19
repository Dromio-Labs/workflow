import {
  ask,
  fail,
  type InferStepContractInput,
  type InferStepContractOutput,
  type OperationContractSourceLike,
  type PromptedContract,
  type PromptedContractLoopDefinition,
  type PromptedContractLoopResult,
  type SafeParseLike,
  type StepContractSourceMap,
  runPromptedContractLoop,
} from "../core/index.js";
import type {
  WorkflowCatalogItem,
} from "../product/catalog/catalog.js";
import {
  createWorkflowCatalog,
} from "../product/catalog/catalog.js";
import type {
  WorkflowDocument,
} from "../product/workflow-document/index.js";
import {
  baseStep,
  type AuthoredStepContext,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";

type PromptedContractCompletedContext<
  TInputContracts extends StepContractSourceMap,
  TContract extends PromptedContract,
> = {
  contract: TContract;
  evaluation: Extract<
    PromptedContractLoopResult<TContract>,
    { status: "completed" }
  >["evaluation"];
  input: InferStepContractInput<TInputContracts>;
};

export type AuthoredPromptedContractStepInput<
  TInputContracts extends StepContractSourceMap,
  TContract extends PromptedContract,
  TOutputContracts extends StepContractSourceMap,
> = Omit<AuthoredStepInput<TInputContracts, TOutputContracts>, "kind" | "run"> & {
  contract: OperationContractSourceLike & SafeParseLike<TContract>;
  definition: PromptedContractLoopDefinition<
    InferStepContractInput<TInputContracts>,
    TContract,
    AuthoredStepContext<TInputContracts>["answers"]
  >;
  mapCompleted(
    context: PromptedContractCompletedContext<TInputContracts, TContract>,
  ):
    | InferStepContractOutput<TOutputContracts>
    | Promise<InferStepContractOutput<TOutputContracts>>;
};

export type PromptedContractInspection = {
  catalog: readonly WorkflowCatalogItem[];
  document: WorkflowDocument;
};

export type AuthoredPromptedContractStepDefinition<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
> = AuthoredStepDefinition<TInputContracts, TOutputContracts> & {
  inspect(): PromptedContractInspection;
  readonly phases: readonly WorkflowCatalogItem[];
  readonly workflowDocument: WorkflowDocument;
  readonly workflows: readonly [{
    catalog: ReturnType<typeof createWorkflowCatalog>;
    document: WorkflowDocument;
  }];
};

/**
 * Wraps the canonical prompted-contract engine as one root authoring composite.
 * Its phase catalog and document are source-visible inspection topology; the
 * core engine remains the single owner of answer history and revision policy.
 */
export function promptedContractStep<
  const TInputContracts extends StepContractSourceMap,
  const TContract extends PromptedContract,
  const TOutputContracts extends StepContractSourceMap,
>(
  input: AuthoredPromptedContractStepInput<TInputContracts, TContract, TOutputContracts>,
): AuthoredPromptedContractStepDefinition<TInputContracts, TOutputContracts> {
  const phases = contractLoopPhases(input.id, input.label ?? input.id);
  const document = contractLoopDocument(input.id, input.label ?? input.id, phases);
  const workflows = [{
    catalog: createWorkflowCatalog([...phases]),
    document,
  }] as const;
  const definition = baseStep({
    ...input,
    execution: {
      childWorkflowDocumentId: document.id,
      kind: "loop",
    },
    implementation: {
      children: phases.map((phase) => phase.id),
      factory: "step.promptedContract",
      kind: "composite",
      workflowDocumentId: document.id,
    },
    kind: "composite",
    async run(context) {
      const result = await runPromptedContractLoop(input.definition, {
        answers: context.answers,
        input: context.input,
        onEvent: context.emit,
        onQuestion(question) {
          return question.id in context.answers
            ? context.answers[question.id]
            : undefined;
        },
        trace: {
          parentSpanId: `step:${context.step.id}:attempt:${context.step.attempt}`,
          spanId: `contract-loop:${input.id}:attempt:${context.step.attempt}`,
          traceId: context.step.runId,
        },
      });
      if (result.status === "needs_input") {
        return result.pendingQuestions.length > 0
          ? ask(result.pendingQuestions)
          : fail(`${input.label ?? input.id} needs input but produced no questions.`);
      }
      if (result.status === "failed") return fail(result.message);
      return input.mapCompleted({
        contract: parseContract(input.contract, result.contract, input.id),
        evaluation: result.evaluation,
        input: context.input,
      });
    },
  });
  return Object.assign(definition, {
    inspect: () => ({ catalog: phases, document }),
    phases,
    workflowDocument: document,
    workflows,
  });
}

function parseContract<TContract extends PromptedContract>(
  source: SafeParseLike<TContract>,
  value: TContract,
  id: string,
): TContract {
  const result = source.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error?.issues ?? [{ message: "Contract validation failed." }];
  throw new Error(
    `Prompted contract ${id} failed validation: ${issues.map((issue) => issue.message ?? "Contract validation failed.").join("; ")}`,
  );
}

function contractLoopPhases(id: string, label: string): readonly WorkflowCatalogItem[] {
  return [
    phase(id, "resolve", "model", `Resolve ${label} contract`),
    phase(id, "assess", "evaluation", `Assess ${label} contract`),
    phase(id, "gate", "gate", `Gate ${label} contract`),
    phase(id, "ask", "question", `Ask for ${label} clarification`),
    phase(id, "merge", "step", `Merge accepted ${label} answers`),
    phase(id, "revise", "model", `Revise ${label} contract`),
    phase(id, "rescore", "evaluation", `Rescore ${label} contract`),
    phase(id, "complete", "step", `Complete ${label} contract`),
    phase(id, "fail", "step", `Fail ${label} contract`),
  ];
}

function phase(
  id: string,
  suffix: string,
  kind: WorkflowCatalogItem["kind"],
  label: string,
): WorkflowCatalogItem {
  return {
    description: `${label}. Executed by the canonical prompted-contract loop.`,
    id: `${id}.${suffix}`,
    implementation: { kind: "builtin", source: "sdk/core/prompted-contract-loop" },
    kind,
    label,
  };
}

function contractLoopDocument(
  id: string,
  label: string,
  phases: readonly WorkflowCatalogItem[],
): WorkflowDocument {
  const phaseId = (suffix: string) => `${id}.${suffix}`;
  return {
    description: `Inspectable phases for ${label}.`,
    edges: [
      { id: "trigger-resolve", source: "trigger", target: "resolve" },
      { id: "resolve-assess", source: "resolve", target: "assess" },
      { id: "assess-gate", source: "assess", target: "gate" },
      { id: "gate-ask", source: "gate", target: "ask" },
      { id: "ask-merge", source: "ask", target: "merge" },
      { id: "merge-revise", source: "merge", target: "revise" },
      { id: "revise-rescore", source: "revise", target: "rescore" },
      { id: "rescore-complete", source: "rescore", target: "complete" },
      { id: "rescore-fail", source: "rescore", target: "fail" },
      { id: "complete-end", source: "complete", target: "end" },
      { id: "fail-end", source: "fail", target: "end" },
    ],
    end: { id: "end", label: "Contract loop terminal", type: "result" },
    id: `${id}.prompted-contract-loop`,
    label: `${label} prompted contract loop`,
    loops: [{
      backTo: "resolve",
      end: "rescore",
      id: "revision-loop",
      label: "Revise until the quality gate passes",
      start: "resolve",
    }],
    nodes: [
      { catalogItemId: phaseId("resolve"), id: "resolve", kind: "model", label: phases[0]!.label },
      { catalogItemId: phaseId("assess"), id: "assess", kind: "evaluation", label: phases[1]!.label },
      { catalogItemId: phaseId("gate"), id: "gate", kind: "gate", label: phases[2]!.label },
      { catalogItemId: phaseId("ask"), id: "ask", kind: "question", label: phases[3]!.label },
      { catalogItemId: phaseId("merge"), id: "merge", kind: "step", label: phases[4]!.label },
      { catalogItemId: phaseId("revise"), id: "revise", kind: "model", label: phases[5]!.label },
      { catalogItemId: phaseId("rescore"), id: "rescore", kind: "evaluation", label: phases[6]!.label },
      { catalogItemId: phaseId("complete"), id: "complete", kind: "step", label: phases[7]!.label },
      { catalogItemId: phaseId("fail"), id: "fail", kind: "step", label: phases[8]!.label },
    ],
    trigger: { id: "trigger", label: "Contract input", type: "manual" },
    version: 1,
  };
}
