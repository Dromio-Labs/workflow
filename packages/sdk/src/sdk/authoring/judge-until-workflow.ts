import {
  fail,
  goto,
  jsonSchemaFromContractSource,
  promptedOperationDecisionSchema,
  type OperationContractSourceLike,
  type StepContractSourceMap,
  type StepState,
} from "../core/index.js";
import type { PromptedOperationDecision } from "../core/prompted-operation/index.js";
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

const judgmentAttemptsContract = z.number().int().min(1);

type JudgmentContracts<TEvaluation extends OperationContractSourceLike> = {
  decision: typeof promptedOperationDecisionSchema;
  evaluation: TEvaluation;
};

type JudgeUntilOutputContracts<
  TCandidateContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = TCandidateContracts & JudgmentContracts<TEvaluation> & {
  attempts: typeof judgmentAttemptsContract;
};

export type AuthoredJudgeUntilWorkflowInput<
  TInputContracts extends StepContractSourceMap,
  TCandidateContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = {
  description?: string;
  exhausted?: AuthoredStepDefinition<StepContractSourceMap, StepContractSourceMap>;
  id: string;
  input: TInputContracts;
  judge: AuthoredJudgeWorkflow<TCandidateContracts, TEvaluation>;
  label?: string;
  maxAttempts: number;
  produce: AuthoredStepDefinition<TInputContracts, TCandidateContracts>;
  revise: AuthoredStepDefinition<StepContractSourceMap, TCandidateContracts>;
};

export type AuthoredJudgeUntilWorkflow<
  TInputContracts extends StepContractSourceMap,
  TCandidateContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = AuthoredWorkflow<
  TInputContracts,
  JudgeUntilOutputContracts<TCandidateContracts, TEvaluation>
> & {
  readonly judge: AuthoredJudgeWorkflow<TCandidateContracts, TEvaluation>;
};

/** Builds a visible produce, judge, revise loop with bounded exhaustion. */
export function judgeUntilWorkflow<
  const TInputContracts extends StepContractSourceMap,
  const TCandidateContracts extends StepContractSourceMap,
  const TEvaluation extends OperationContractSourceLike,
>(input: AuthoredJudgeUntilWorkflowInput<
  TInputContracts,
  TCandidateContracts,
  TEvaluation
>): AuthoredJudgeUntilWorkflow<TInputContracts, TCandidateContracts, TEvaluation> {
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new Error(`Judge-until workflow ${input.id} requires maxAttempts >= 1.`);
  }
  const judge = workflowStep({
    id: `${input.id}.judge`,
    kind: "evaluation",
    label: `Judge ${input.label ?? input.id}`,
    workflow: input.judge,
  });
  const route = baseStep({
    id: `${input.id}.route`,
    input: input.judge.output,
    kind: "gate",
    label: `Route ${input.label ?? input.id} judgment`,
    output: { attempts: judgmentAttemptsContract },
    run(context) {
      const decision = context.input.decision as PromptedOperationDecision;
      const attempts = context.step.attempt;
      if (decision.status === "completed") {
        return goto("complete", "judgment passed", { attempts });
      }
      if (decision.nextAction === "cancel") {
        return fail(`${input.label ?? input.id} judgment requested cancellation.`, { attempts });
      }
      if (decision.status === "rejected") {
        return fail(`${input.label ?? input.id} judgment was rejected.`, { attempts });
      }
      if (decision.status === "failed") {
        return fail(`${input.label ?? input.id} judgment failed.`, { attempts });
      }
      if (attempts >= input.maxAttempts) {
        return input.exhausted
          ? goto("exhausted", "judgment attempts exhausted", { attempts })
          : fail(
            `${input.label ?? input.id} did not pass after ${input.maxAttempts} judgment attempts.`,
            { attempts },
          );
      }
      return { attempts };
    },
  });
  const revise = gotoAfterDone(input.revise, "judge", "candidate revised");
  const output = {
    ...input.produce.output,
    ...input.judge.output,
    attempts: judgmentAttemptsContract,
  } as JudgeUntilOutputContracts<TCandidateContracts, TEvaluation>;
  const complete = baseStep({
    id: `${input.id}.complete`,
    input: output,
    kind: "step",
    label: `Complete ${input.label ?? input.id}`,
    output,
    run({ input: completed }) {
      return completed;
    },
  });
  const catalog = [
    input.produce,
    judge,
    route,
    revise,
    ...(input.exhausted ? [input.exhausted] : []),
    complete,
  ];
  const document = judgeUntilDocument(input, {
    complete: complete.id,
    exhausted: input.exhausted?.id,
    judge: judge.id,
    produce: input.produce.id,
    revise: revise.id,
    route: route.id,
  }, output);
  return Object.assign(authoredWorkflow({
    catalog,
    document,
    input: input.input,
    output,
  }), { judge: input.judge });
}

function gotoAfterDone<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
>(
  source: AuthoredStepDefinition<TInputContracts, TOutputContracts>,
  target: string,
  reason: string,
): AuthoredStepDefinition<TInputContracts, TOutputContracts> {
  return authoredStepDefinition({
    capabilities: source.capabilities,
    description: source.description,
    execution: source.execution,
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
        return goto(target, reason, {
          ...(result.state ?? {}),
          ...output,
        });
      },
    };
  });
}

function judgeUntilDocument<
  TInputContracts extends StepContractSourceMap,
  TCandidateContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
>(
  input: AuthoredJudgeUntilWorkflowInput<TInputContracts, TCandidateContracts, TEvaluation>,
  ids: {
    complete: string;
    exhausted?: string;
    judge: string;
    produce: string;
    revise: string;
    route: string;
  },
  output: JudgeUntilOutputContracts<TCandidateContracts, TEvaluation>,
): WorkflowDocument {
  const nodes: WorkflowDocument["nodes"] = [
    { catalogItemId: ids.produce, id: "produce", label: "Produce candidate", role: "resolve" },
    { catalogItemId: ids.judge, id: "judge", kind: "evaluation", label: "Judge candidate", role: "judge" },
    { catalogItemId: ids.route, id: "route", kind: "gate", label: "Route judgment", role: "gate" },
    { catalogItemId: ids.revise, id: "revise", label: "Revise candidate", role: "revise" },
    ...(ids.exhausted
      ? [{ catalogItemId: ids.exhausted, id: "exhausted", label: "Handle exhaustion", role: "ask" }]
      : []),
    { catalogItemId: ids.complete, id: "complete", label: "Complete judgment", role: "complete" },
  ];
  const sequence = ["trigger", "produce", "judge", "route", "revise", ...(ids.exhausted ? ["exhausted"] : []), "complete", "end"];
  return {
    description: input.description ?? `Judge and revise ${input.label ?? input.id} until it passes.`,
    edges: sequence.slice(1).map((target, index) => ({
      id: `${sequence[index]}-to-${target}`,
      source: sequence[index]!,
      target,
    })),
    end: {
      id: "end",
      label: "Judgment loop completed",
      output: contractDocument(output),
      type: "result",
    },
    id: `${input.id}.judge-until`,
    label: input.label ?? input.id,
    loops: [{ backTo: "judge", end: "revise", id: "judgment-loop", start: "judge" }],
    nodes,
    trigger: {
      id: "trigger",
      input: contractDocument(input.input),
      label: "Candidate input",
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

function isState(value: unknown): value is StepState {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
