import {
  ask,
  evaluationCompletedEvent,
  fail,
  goto,
  jsonSchemaFromContractSource,
  passthroughOperationContract,
  type EvaluationBar,
  type InferStepContractInput,
  type InferStepContractOutput,
  type OperationContractSourceLike,
  type PromptedContract,
  type PromptedContractLoopDefinition,
  type PromptedContractLoopResult,
  type Question,
  type QuestionResolution,
  type SafeParseLike,
  type StepContractSourceMap,
} from "../core/index.js";
import type { WorkflowCatalogItem } from "../product/catalog/catalog.js";
import { FailedChildWorkflowError } from "../product/workflow/child-workflow.js";
import type { WorkflowDocument } from "../product/workflow-document/index.js";
import { z } from "zod";
import {
  baseStep,
  type AuthoredStepContext,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";
import { workflow } from "./workflow.js";
import { workflowStep } from "./workflow-step.js";

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
    catalog: ReturnType<typeof workflow>["catalog"];
    document: WorkflowDocument;
  }];
};

/**
 * Compatibility placement for the prompted-contract authoring contract.
 *
 * @deprecated Use `workflow.clarifyUntil()` for new clarification workflows.
 */
export function promptedContractStep<
  const TInputContracts extends StepContractSourceMap,
  const TContract extends PromptedContract,
  const TOutputContracts extends StepContractSourceMap,
>(
  input: AuthoredPromptedContractStepInput<TInputContracts, TContract, TOutputContracts>,
): AuthoredPromptedContractStepDefinition<TInputContracts, TOutputContracts> {
  const child = promptedContractWorkflow(input);
  const placed = workflowStep({
    id: input.id,
    kind: "composite",
    label: input.label,
    workflow: child,
  });
  const createPlacedStep = placed.create.bind(placed);
  const phases = child.catalog.items();
  const workflows = [{ catalog: child.catalog, document: child.document }] as const;
  return Object.assign(placed, {
    create(createInput: Parameters<typeof placed.create>[0] = {}) {
      const runtime = createPlacedStep(createInput);
      return {
        ...runtime,
        async run(context: Parameters<typeof runtime.run>[0]) {
          try {
            return await runtime.run(context);
          } catch (error) {
            if (error instanceof FailedChildWorkflowError) {
              return fail(error.message);
            }
            throw error;
          }
        },
      };
    },
    implementation: {
      ...placed.implementation,
      factory: "step.promptedContract",
    },
    inspect: () => ({ catalog: phases, document: child.document }),
    phases,
    workflowDocument: child.document,
    workflows,
  });
}

function promptedContractWorkflow<
  TInputContracts extends StepContractSourceMap,
  TContract extends PromptedContract,
  TOutputContracts extends StepContractSourceMap,
>(input: AuthoredPromptedContractStepInput<TInputContracts, TContract, TOutputContracts>) {
  const answersContract = z.record(z.string(), z.unknown());
  const evaluationContract = passthroughOperationContract<`${string}.evaluation`, EvaluationBar>(
    `${input.id}.evaluation`,
  );
  const questionsContract = passthroughOperationContract<`${string}.questions`, readonly Question[]>(
    `${input.id}.questions`,
  );
  const resolverId = `${input.id}.answer`;
  const maxLoops = input.definition.revisionPolicy?.maxContractLoops ?? 4;

  const resolve = baseStep({
    id: `${input.id}.resolve`,
    input: input.input,
    kind: "step",
    label: `Resolve ${input.label ?? input.id} contract`,
    output: { contract: input.contract, contractAnswers: answersContract },
    async run(context) {
      const contractAnswers = isRecord(context.state.contractAnswers)
        ? context.state.contractAnswers
        : {};
      const contract = await input.definition.resolveContract({
        answers: contractAnswers,
        contract: isPromptedContract(context.state.contract)
          ? context.state.contract as TContract
          : undefined,
        emit: async (event) => {
          context.emit(event);
        },
        input: context.workflowInput as InferStepContractInput<TInputContracts>,
        iteration: context.step.attempt - 1,
        trace: {
          parentSpanId: `step:${context.step.id}:attempt:${context.step.attempt}`,
          spanId: `contract-loop:${input.id}:resolve:${context.step.attempt}`,
          traceId: context.step.runId,
        },
      });
      return { contract: parseContract(input.contract, contract, input.id), contractAnswers };
    },
  });
  const assess = baseStep({
    id: `${input.id}.assess`,
    input: { contract: input.contract, contractAnswers: answersContract },
    kind: "evaluation",
    label: `Assess ${input.label ?? input.id} contract`,
    output: { evaluation: evaluationContract },
    async run(context) {
      const evaluation = await input.definition.evaluateContract({
        answers: context.input.contractAnswers,
        contract: context.input.contract,
        input: context.workflowInput as InferStepContractInput<TInputContracts>,
        iteration: context.step.attempt - 1,
      });
      await context.emit(evaluationCompletedEvent({ bar: evaluation }));
      return { evaluation };
    },
  });
  const gate = baseStep({
    id: `${input.id}.gate`,
    input: {
      contract: input.contract,
      contractAnswers: answersContract,
      evaluation: evaluationContract,
    },
    kind: "gate",
    label: `Gate ${input.label ?? input.id} contract`,
    output: { questions: questionsContract },
    run(context) {
      if (passes(context.input.evaluation)) {
        return goto("complete", "prompted contract passed");
      }
      if (context.step.attempt >= maxLoops) {
        return fail(`${input.label ?? input.id} exceeded ${maxLoops} contract loops.`);
      }
      const questions = questionsFor(
        input.definition,
        context.input.contractAnswers,
        context.input.contract,
        context.input.evaluation,
      ).map((question) => ({
        ...question,
        answerSchema: questionAnswerSchema(question),
        resolverId,
      }));
      return questions.length > 0
        ? { questions }
        : fail(`${input.label ?? input.id} needs input but produced no questions.`);
    },
  });
  const askQuestions = baseStep({
    id: `${input.id}.ask`,
    input: { questions: questionsContract },
    kind: "question",
    label: `Ask for ${input.label ?? input.id} clarification`,
    output: { questions: questionsContract },
    sideEffects: ["human.input"],
    run(context) {
      const pending = context.input.questions.filter((question) =>
        !(question.id in context.answers)
      );
      return pending.length > 0 ? ask(pending) : { questions: context.input.questions };
    },
  });
  const merge = baseStep({
    id: `${input.id}.merge`,
    input: {
      contract: input.contract,
      contractAnswers: answersContract,
      questions: questionsContract,
    },
    kind: "step",
    label: `Merge accepted ${input.label ?? input.id} answers`,
    output: { contractAnswers: answersContract },
    async run(context) {
      let answers = { ...context.input.contractAnswers };
      for (const question of context.input.questions) {
        const value = context.answers[question.id];
        answers = input.definition.mergeAnswer
          ? await input.definition.mergeAnswer({
            answers,
            contract: context.input.contract,
            question,
            resolution: acceptedResolution(value),
            value,
          })
          : { ...answers, [question.id]: value };
      }
      return { contractAnswers: answers };
    },
  });
  const revise = baseStep({
    id: `${input.id}.revise`,
    input: { contractAnswers: answersContract },
    kind: "step",
    label: `Revise ${input.label ?? input.id} contract`,
    output: { contractAnswers: answersContract },
    run: ({ input: revised }) => goto("resolve", "accepted answers require contract revision", revised),
  });
  const complete = baseStep({
    id: `${input.id}.complete`,
    input: { contract: input.contract, evaluation: evaluationContract },
    kind: "step",
    label: `Complete ${input.label ?? input.id} contract`,
    output: input.output,
    run(context) {
      return input.mapCompleted({
        contract: context.input.contract,
        evaluation: context.input.evaluation,
        input: context.workflowInput as InferStepContractInput<TInputContracts>,
      });
    },
  });
  const phases = [resolve, assess, gate, askQuestions, merge, revise, complete];
  const document = promptedContractDocument(input, phases);
  return workflow({
    catalog: phases,
    document,
    input: input.input,
    output: input.output,
    questionResolvers: {
      async [resolverId](resolution) {
        if (!input.definition.answerEvaluator) return acceptedResolution(resolution.utterance);
        const contract = resolution.state.contract;
        if (!isPromptedContract(contract)) {
          return {
            confidence: 1,
            kind: "unclear" as const,
            message: "The prompted contract is unavailable for answer validation.",
            status: "needs_input" as const,
          };
        }
        const result = await input.definition.answerEvaluator({
          answers: isRecord(resolution.state.contractAnswers)
            ? resolution.state.contractAnswers
            : {},
          contract: contract as TContract,
          history: resolution.history ?? [],
          question: resolution.question,
          trace: resolution.trace,
          utterance: resolution.utterance,
        });
        return "resolution" in result ? result.resolution : result;
      },
    },
  });
}

function promptedContractDocument<
  TInputContracts extends StepContractSourceMap,
  TContract extends PromptedContract,
  TOutputContracts extends StepContractSourceMap,
>(
  input: AuthoredPromptedContractStepInput<TInputContracts, TContract, TOutputContracts>,
  phases: readonly AuthoredStepDefinition[],
): WorkflowDocument {
  const ids = Object.fromEntries(phases.map((phase) => [phase.id.split(".").at(-1), phase.id]));
  const nodes: WorkflowDocument["nodes"] = [
    { catalogItemId: ids.resolve!, id: "resolve", kind: "step", label: phases[0]!.label, role: "resolve" },
    { catalogItemId: ids.assess!, id: "assess", kind: "evaluation", label: phases[1]!.label, role: "judge" },
    { catalogItemId: ids.gate!, id: "gate", kind: "gate", label: phases[2]!.label, role: "gate" },
    { catalogItemId: ids.ask!, id: "ask", kind: "question", label: phases[3]!.label, role: "ask" },
    { catalogItemId: ids.merge!, id: "merge", kind: "step", label: phases[4]!.label, role: "merge" },
    { catalogItemId: ids.revise!, id: "revise", kind: "step", label: phases[5]!.label, role: "revise" },
    { catalogItemId: ids.complete!, id: "complete", kind: "step", label: phases[6]!.label, role: "complete" },
  ];
  const sequence = ["trigger", ...nodes.map((node) => node.id), "end"];
  return {
    description: `Executable compatibility workflow for ${input.label ?? input.id}.`,
    edges: sequence.slice(1).map((target, index) => ({
      id: `${sequence[index]}-${target}`,
      source: sequence[index]!,
      target,
    })),
    end: {
      id: "end",
      label: "Contract loop completed",
      output: contractDocument(input.output),
      type: "result",
    },
    id: `${input.id}.prompted-contract-loop`,
    label: `${input.label ?? input.id} prompted contract loop`,
    loops: [{ backTo: "resolve", end: "revise", id: "revision-loop", start: "resolve" }],
    nodes,
    trigger: {
      id: "trigger",
      input: contractDocument(input.input),
      label: "Contract input",
      type: "manual",
    },
    version: 1,
  };
}

function questionsFor<TContract extends PromptedContract>(
  definition: PromptedContractLoopDefinition<Record<string, unknown>, TContract, Record<string, unknown>>,
  answers: Record<string, unknown>,
  contract: TContract,
  evaluation: EvaluationBar,
): readonly Question[] {
  if (definition.createQuestions) return definition.createQuestions({ answers, contract, evaluation });
  if (contract.questions?.length) return contract.questions;
  return contract.requirements.flatMap((requirement) => requirement.question ? [requirement.question] : []);
}

function acceptedResolution(value: unknown): QuestionResolution {
  return { confidence: 1, kind: "answer", normalizedValue: value, status: "accepted" };
}

function contractDocument(contracts: StepContractSourceMap | undefined) {
  return Object.fromEntries(Object.entries(contracts ?? {}).map(([key, contract]) => [
    key,
    { jsonSchema: jsonSchemaFromContractSource(contract) },
  ]));
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

function passes(evaluation: EvaluationBar) {
  return evaluation.status === "pass" && evaluation.score >= evaluation.threshold;
}

function questionAnswerSchema(question: Question): unknown {
  if (question.type === "choice") {
    return { enum: (question.options ?? []).map((option) => option.value), type: "string" };
  }
  if (question.type === "multi") {
    return {
      items: { enum: (question.options ?? []).map((option) => option.value), type: "string" },
      type: "array",
    };
  }
  return question.type === "confirm" ? { type: "boolean" } : { type: "string" };
}

function isPromptedContract(value: unknown): value is PromptedContract {
  return isRecord(value) && typeof value.kind === "string" && Array.isArray(value.requirements);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
