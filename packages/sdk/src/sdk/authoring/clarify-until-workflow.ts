import {
  ask,
  done,
  fail,
  goto,
  jsonSchemaFromContractSource,
  normalizeOperationContract,
  parseOperationContract,
  type InferOperationContractSource,
  type InferStepContractInput,
  type OperationContractSourceLike,
  type PromptedOperationDecision,
  type Question,
  type StepContractSourceMap,
  type StepState,
} from "../core/index.js";
import type { WorkflowDocument } from "../product/index.js";
import { z } from "zod";
import type { AuthoredJudgeWorkflow } from "./judge-workflow.js";
import {
  authoredStepDefinition,
  baseStep,
  type AuthoredStepDefinition,
} from "./step.js";
import { workflow as authoredWorkflow, type AuthoredWorkflow } from "./workflow.js";
import { workflowStep } from "./workflow-step.js";

export const clarificationAcceptedAnswerSchema = z.object({
  questionId: z.string().trim().min(1),
  requirementId: z.string().trim().min(1),
  round: z.number().int().min(1),
  source: z.literal("human"),
  value: z.unknown(),
});

export const clarificationAcceptedAnswersSchema = z.array(clarificationAcceptedAnswerSchema);

export type ClarificationAcceptedAnswer = z.infer<typeof clarificationAcceptedAnswerSchema>;

type ResolutionContracts<
  TContract extends OperationContractSourceLike,
  TBlockers extends OperationContractSourceLike,
> = {
  blockers: TBlockers;
  contract: TContract;
};

type ClarificationState<
  TInputContracts extends StepContractSourceMap,
  TContract extends OperationContractSourceLike,
  TBlockers extends OperationContractSourceLike,
> = {
  acceptedAnswers: ClarificationAcceptedAnswer[];
  blockers: InferOperationContractSource<TBlockers>;
  contract: InferOperationContractSource<TContract>;
  input: InferStepContractInput<TInputContracts>;
  round: number;
};

export type AuthoredClarifyUntilWorkflowInput<
  TInputContracts extends StepContractSourceMap,
  TContract extends OperationContractSourceLike,
  TBlockers extends OperationContractSourceLike,
  TEvaluation extends OperationContractSourceLike,
  TAnswer extends OperationContractSourceLike,
> = {
  answer: TAnswer;
  blockers: TBlockers;
  contract: TContract;
  description?: string;
  exhausted?: AuthoredStepDefinition<StepContractSourceMap, StepContractSourceMap>;
  hasBlockers?(blockers: InferOperationContractSource<TBlockers>): boolean;
  id: string;
  input: TInputContracts;
  judge: AuthoredJudgeWorkflow<{ contract: TContract }, TEvaluation>;
  label?: string;
  maxRounds: number;
  merge(context: ClarificationState<TInputContracts, TContract, TBlockers> & {
    answer: InferOperationContractSource<TAnswer>;
    question: Question;
  }): ResolutionValue<TContract, TBlockers> | Promise<ResolutionValue<TContract, TBlockers>>;
  question(context: ClarificationState<TInputContracts, TContract, TBlockers>): Question;
  resolve: AuthoredStepDefinition<TInputContracts, ResolutionContracts<TContract, TBlockers>>;
  revise: AuthoredStepDefinition<StepContractSourceMap, ResolutionContracts<TContract, TBlockers>>;
};

type ResolutionValue<
  TContract extends OperationContractSourceLike,
  TBlockers extends OperationContractSourceLike,
> = {
  blockers: InferOperationContractSource<TBlockers>;
  contract: InferOperationContractSource<TContract>;
};

export type AuthoredClarifyUntilWorkflow<
  TInputContracts extends StepContractSourceMap,
  TContract extends OperationContractSourceLike,
> = AuthoredWorkflow<TInputContracts, { contract: TContract }>;

/** Builds a durable resolve, judge, ask, merge, and revise clarification loop. */
export function clarifyUntilWorkflow<
  const TInputContracts extends StepContractSourceMap,
  const TContract extends OperationContractSourceLike,
  const TBlockers extends OperationContractSourceLike,
  const TEvaluation extends OperationContractSourceLike,
  const TAnswer extends OperationContractSourceLike,
>(input: AuthoredClarifyUntilWorkflowInput<
  TInputContracts,
  TContract,
  TBlockers,
  TEvaluation,
  TAnswer
>): AuthoredClarifyUntilWorkflow<TInputContracts, TContract> {
  if (!Number.isInteger(input.maxRounds) || input.maxRounds < 1) {
    throw new Error(`Clarify-until workflow ${input.id} requires maxRounds >= 1.`);
  }
  const answerContract = normalizeOperationContract(`${input.id}.answer`, input.answer);
  const resolverId = `${input.id}.answer`;
  const resolutionOutput = { blockers: input.blockers, contract: input.contract };
  const resolve = initializeAcceptedAnswers(input.resolve);
  const judge = workflowStep({
    id: `${input.id}.judge`,
    kind: "evaluation",
    label: `Judge ${input.label ?? input.id} completeness`,
    workflow: input.judge,
  });
  const route = baseStep({
    id: `${input.id}.route`,
    input: { blockers: input.blockers, ...input.judge.output },
    kind: "gate",
    label: `Route ${input.label ?? input.id} clarification`,
    output: { rounds: z.number().int().min(1) },
    run(context) {
      const decision = context.input.decision as PromptedOperationDecision;
      const blocked = input.hasBlockers
        ? input.hasBlockers(context.input.blockers)
        : defaultHasBlockers(context.input.blockers);
      const answeredRounds = Array.isArray(context.state.acceptedAnswers)
        ? context.state.acceptedAnswers.length
        : 0;
      const rounds = answeredRounds + 1;
      if (decision.status === "completed" && !blocked) {
        return goto("complete", "contract is complete", { rounds: answeredRounds });
      }
      if (decision.nextAction === "cancel") {
        return fail(`${input.label ?? input.id} clarification requested cancellation.`, { rounds });
      }
      if (decision.status === "rejected") {
        return fail(`${input.label ?? input.id} clarification was rejected.`, { rounds });
      }
      if (decision.status === "failed") {
        return fail(`${input.label ?? input.id} clarification judgment failed.`, { rounds });
      }
      const exhausted = blocked
        ? answeredRounds >= input.maxRounds
        : context.step.attempt >= input.maxRounds;
      if (exhausted) {
        return input.exhausted
          ? goto("exhausted", "clarification rounds exhausted", { rounds })
          : fail(
            `${input.label ?? input.id} still has blocking requirements after ${input.maxRounds} rounds.`,
            { rounds },
          );
      }
      if (!blocked) {
        return goto("revise", "contract score requires revision", { rounds });
      }
      return { rounds };
    },
  });
  const question = baseStep({
    id: `${input.id}.ask`,
    input: {
      acceptedAnswers: clarificationAcceptedAnswersSchema,
      blockers: input.blockers,
      contract: input.contract,
    },
    kind: "question",
    label: `Ask for ${input.label ?? input.id} clarification`,
    output: { acceptedAnswer: clarificationAcceptedAnswerSchema },
    sideEffects: ["human.input"],
    run(context) {
      const round = Number(context.state.rounds ?? context.step.attempt);
      const authored = input.question({
        acceptedAnswers: context.input.acceptedAnswers,
        blockers: context.input.blockers,
        contract: context.input.contract,
        input: context.workflowInput as InferStepContractInput<TInputContracts>,
        round,
      });
      const focused = {
        ...authored,
        answerSchema: jsonSchemaFromContractSource(input.answer),
        resolverId,
      };
      if (!(focused.id in context.answers)) return ask(focused);
      const answer = parseOperationContract(answerContract, context.answers[focused.id]);
      return {
        acceptedAnswer: {
          questionId: focused.id,
          requirementId: focused.requirementId ?? focused.id,
          round,
          source: "human" as const,
          value: answer,
        },
      };
    },
  });
  const merge = baseStep({
    id: `${input.id}.merge`,
    input: {
      acceptedAnswer: clarificationAcceptedAnswerSchema,
      acceptedAnswers: clarificationAcceptedAnswersSchema,
      blockers: input.blockers,
      contract: input.contract,
    },
    kind: "step",
    label: `Merge accepted ${input.label ?? input.id} answer`,
    output: {
      acceptedAnswers: clarificationAcceptedAnswersSchema,
      ...resolutionOutput,
    },
    async run(context) {
      const acceptedAnswers = [...context.input.acceptedAnswers, context.input.acceptedAnswer];
      const question = input.question({
        acceptedAnswers: context.input.acceptedAnswers,
        blockers: context.input.blockers,
        contract: context.input.contract,
        input: context.workflowInput as InferStepContractInput<TInputContracts>,
        round: context.input.acceptedAnswer.round,
      });
      const merged = await input.merge({
        acceptedAnswers,
        answer: context.input.acceptedAnswer.value as InferOperationContractSource<TAnswer>,
        blockers: context.input.blockers,
        contract: context.input.contract,
        input: context.workflowInput as InferStepContractInput<TInputContracts>,
        question,
        round: context.input.acceptedAnswer.round,
      });
      const violation = acceptedFactViolation(
        context.input.contract,
        merged.contract,
        acceptedAnswers,
      );
      if (violation) return fail(violation);
      return { acceptedAnswers, ...merged } as never;
    },
  });
  const revise = reviseWithoutAcceptedFactChanges(input.revise, "judge", "contract revised");
  const complete = baseStep({
    id: `${input.id}.complete`,
    input: { contract: input.contract },
    kind: "step",
    label: `Complete ${input.label ?? input.id} contract`,
    output: { contract: input.contract },
    run: ({ input: completed }) => completed,
  });
  const catalog = [
    resolve,
    judge,
    route,
    question,
    merge,
    revise,
    ...(input.exhausted ? [input.exhausted] : []),
    complete,
  ];
  const document = clarifyDocument(input, {
    ask: question.id,
    complete: complete.id,
    exhausted: input.exhausted?.id,
    judge: judge.id,
    merge: merge.id,
    resolve: resolve.id,
    revise: revise.id,
    route: route.id,
  });
  return authoredWorkflow({
    catalog,
    document,
    input: input.input,
    output: { contract: input.contract },
    questionResolvers: {
      [resolverId](resolution) {
        const result = answerContract.safeParse(resolution.utterance);
        return result.success
          ? {
            confidence: 1,
            kind: "answer" as const,
            normalizedValue: result.data,
            status: "accepted" as const,
          }
          : {
            confidence: 1,
            kind: "unclear" as const,
            message: result.issues.map((issue) => issue.message).join("; "),
            status: "needs_input" as const,
          };
      },
    },
  });
}

function initializeAcceptedAnswers<
  TInputContracts extends StepContractSourceMap,
  TContract extends OperationContractSourceLike,
  TBlockers extends OperationContractSourceLike,
>(source: AuthoredStepDefinition<TInputContracts, ResolutionContracts<TContract, TBlockers>>) {
  return authoredStepDefinition({
    description: source.description,
    id: source.id,
    implementation: source.implementation,
    input: source.input,
    kind: source.kind,
    label: source.label,
    output: { ...source.output, acceptedAnswers: clarificationAcceptedAnswersSchema },
    sideEffects: source.sideEffects,
  }, (createInput) => {
    const created = source.create(createInput);
    return {
      ...created,
      output: undefined,
      async run(context) {
        const result = await created.run(context);
        if (result.type !== "done") return result;
        return done({
          ...(isState(result.output) ? result.output : {}),
          acceptedAnswers: [],
        }, result.state);
      },
    };
  });
}

function reviseWithoutAcceptedFactChanges<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
>(source: AuthoredStepDefinition<TInputContracts, TOutputContracts>, target: string, reason: string) {
  return authoredStepDefinition({
    description: source.description,
    id: source.id,
    implementation: source.implementation,
    input: source.input,
    kind: source.kind,
    label: source.label,
    output: source.output,
    sideEffects: source.sideEffects,
  }, (createInput) => {
    const created = source.create(createInput);
    return {
      ...created,
      async run(context) {
        const result = await created.run(context);
        if (result.type !== "done") return result;
        const output = isState(result.output) ? result.output : {};
        const violation = acceptedFactViolation(
          isRecord(context.input) ? context.input.contract : undefined,
          output.contract,
          Array.isArray(context.state.acceptedAnswers)
            ? context.state.acceptedAnswers as ClarificationAcceptedAnswer[]
            : [],
        );
        if (violation) return fail(violation);
        return goto(target, reason, {
          ...(result.state ?? {}),
          ...output,
        });
      },
    };
  });
}

function acceptedFactViolation(
  previousContract: unknown,
  nextContract: unknown,
  acceptedAnswers: readonly ClarificationAcceptedAnswer[],
): string | undefined {
  if (!isRecord(nextContract)) return undefined;
  const previous = isRecord(previousContract) ? previousContract : {};
  for (const answer of acceptedAnswers) {
    const key = answer.requirementId;
    const previouslyMapped = Object.hasOwn(previous, key)
      && sameJsonValue(previous[key], answer.value);
    const nextHasKey = Object.hasOwn(nextContract, key);
    if (nextHasKey && !sameJsonValue(nextContract[key], answer.value)) {
      return `Contract revision contradicts accepted human answer for ${key}.`;
    }
    if (previouslyMapped && !nextHasKey) {
      return `Contract revision deletes accepted human answer for ${key}.`;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clarifyDocument<
  TInputContracts extends StepContractSourceMap,
  TContract extends OperationContractSourceLike,
  TBlockers extends OperationContractSourceLike,
  TEvaluation extends OperationContractSourceLike,
  TAnswer extends OperationContractSourceLike,
>(
  input: AuthoredClarifyUntilWorkflowInput<TInputContracts, TContract, TBlockers, TEvaluation, TAnswer>,
  ids: Record<"ask" | "complete" | "judge" | "merge" | "resolve" | "revise" | "route", string>
    & { exhausted?: string },
): WorkflowDocument {
  const nodes: WorkflowDocument["nodes"] = [
    { catalogItemId: ids.resolve, id: "resolve", label: "Resolve contract", role: "resolve" },
    { catalogItemId: ids.judge, id: "judge", kind: "evaluation", label: "Judge completeness", role: "judge" },
    { catalogItemId: ids.route, id: "route", kind: "gate", label: "Route completeness", role: "gate" },
    { catalogItemId: ids.ask, id: "ask", kind: "question", label: "Ask one focused question", role: "ask" },
    { catalogItemId: ids.merge, id: "merge", label: "Merge accepted answer", role: "merge" },
    { catalogItemId: ids.revise, id: "revise", label: "Revise contract", role: "revise" },
    ...(ids.exhausted
      ? [{ catalogItemId: ids.exhausted, id: "exhausted", label: "Handle exhaustion", role: "ask" }]
      : []),
    { catalogItemId: ids.complete, id: "complete", label: "Complete contract", role: "complete" },
  ];
  const sequence = ["trigger", ...nodes.map((node) => node.id), "end"];
  return {
    description: input.description ?? `Clarify ${input.label ?? input.id} until no blocking requirements remain.`,
    edges: sequence.slice(1).map((target, index) => ({
      id: `${sequence[index]}-to-${target}`,
      source: sequence[index]!,
      target,
    })),
    end: {
      id: "end",
      label: "Clarification completed",
      output: { contract: { jsonSchema: jsonSchemaFromContractSource(input.contract) } },
      type: "result",
    },
    id: `${input.id}.clarify-until`,
    label: input.label ?? input.id,
    loops: [{ backTo: "judge", end: "revise", id: "clarification-loop", start: "judge" }],
    nodes,
    trigger: {
      id: "trigger",
      input: contractDocument(input.input),
      label: "Clarification input",
      type: "manual",
    },
    version: 1,
  };
}

function contractDocument(contracts: StepContractSourceMap) {
  return Object.fromEntries(Object.entries(contracts).map(([key, contract]) => [
    key,
    { jsonSchema: jsonSchemaFromContractSource(contract) },
  ]));
}

function defaultHasBlockers(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function isState(value: unknown): value is StepState {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
