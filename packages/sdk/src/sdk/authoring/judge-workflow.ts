import {
  jsonSchemaFromContractSource,
  promptedOperationDecisionSchema,
  type CandidateScorePolicy,
  type InferStepContractInput,
  type OperationContractSourceLike,
  type StepContractSourceMap,
} from "../core/index.js";
import type { ModelWorkerSource } from "../product/model/index.js";
import type { PromptSource } from "../product/prompts/index.js";
import type { WorkflowDocument } from "../product/index.js";
import { gateStep } from "./gate-step.js";
import { modelStep } from "./model-step.js";
import {
  ejectEvaluationSource,
  type EvaluationEjectOptions,
  type EvaluationEjectWriteResult,
} from "./evaluation-eject.js";
import type { AuthoredStepDefinition } from "./step.js";
import {
  workflow as authoredWorkflow,
  type AuthoredWorkflow,
} from "./workflow.js";
import { workflowStep } from "./workflow-step.js";

type JudgmentOutputContracts<TEvaluation extends OperationContractSourceLike> = {
  decision: typeof promptedOperationDecisionSchema;
  evaluation: TEvaluation;
};

type AuthoredJudgeWorkflowBase<
  TInputContracts extends StepContractSourceMap,
  TPolicy extends CandidateScorePolicy,
> = {
  description?: string;
  id: string;
  input: TInputContracts;
  label?: string;
  policy: TPolicy;
};

export type AuthoredModelJudgeWorkflowInput<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
  TPolicy extends CandidateScorePolicy,
> = AuthoredJudgeWorkflowBase<TInputContracts, TPolicy> & {
  assessor?: never;
  evaluator: {
    buildPrompt?(input: {
      input: InferStepContractInput<TInputContracts>;
      policy: TPolicy;
    }): string | unknown;
    model?: ModelWorkerSource;
    operation?: string;
    output: { evaluation: TEvaluation };
    prompt: PromptSource;
  };
};

export type AuthoredComposedJudgeWorkflowInput<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
  TPolicy extends CandidateScorePolicy,
> = AuthoredJudgeWorkflowBase<TInputContracts, TPolicy> & {
  assessor:
    | AuthoredStepDefinition<TInputContracts, { evaluation: TEvaluation }>
    | AuthoredWorkflow<TInputContracts, { evaluation: TEvaluation }>;
  evaluator?: never;
};

export type AuthoredJudgeWorkflowInput<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
  TPolicy extends CandidateScorePolicy,
> =
  | AuthoredComposedJudgeWorkflowInput<TInputContracts, TEvaluation, TPolicy>
  | AuthoredModelJudgeWorkflowInput<TInputContracts, TEvaluation, TPolicy>;

export type EjectedJudgmentWorkflow<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = {
  assessor: AuthoredStepDefinition<TInputContracts, { evaluation: TEvaluation }>;
  document: WorkflowDocument;
  gate: AuthoredStepDefinition<
    { evaluation: TEvaluation },
    JudgmentOutputContracts<TEvaluation>
  >;
  workflow: AuthoredWorkflow<
    TInputContracts,
    JudgmentOutputContracts<TEvaluation>
  >;
};

export type AuthoredJudgeWorkflow<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = AuthoredWorkflow<
  TInputContracts,
  JudgmentOutputContracts<TEvaluation>
> & {
  readonly assessor: AuthoredStepDefinition<TInputContracts, { evaluation: TEvaluation }>;
  eject(): EjectedJudgmentWorkflow<TInputContracts, TEvaluation>;
  eject(options: EvaluationEjectOptions): EjectedJudgmentWorkflow<TInputContracts, TEvaluation>
    & EvaluationEjectWriteResult;
  readonly gate: AuthoredStepDefinition<
    { evaluation: TEvaluation },
    JudgmentOutputContracts<TEvaluation>
  >;
};

/** Builds one visible assessment followed by one deterministic score gate. */
export function judgeWorkflow<
  const TInputContracts extends StepContractSourceMap,
  const TEvaluation extends OperationContractSourceLike,
  const TPolicy extends CandidateScorePolicy,
>(input: AuthoredJudgeWorkflowInput<
  TInputContracts,
  TEvaluation,
  TPolicy
>): AuthoredJudgeWorkflow<TInputContracts, TEvaluation> {
  const assessor = "assessor" in input && input.assessor
    ? authoredAssessor(input.id, input.assessor)
    : modelStep({
      id: `${input.id}.assess`,
      input: input.input,
      label: `Assess ${input.label ?? input.id}`,
      model: input.evaluator.model,
      operation: input.evaluator.operation ?? "assess",
      output: input.evaluator.output,
      prompt: input.evaluator.prompt,
      buildPrompt: (stepInput) => input.evaluator.buildPrompt?.({
        input: stepInput,
        policy: input.policy,
      }) ?? { input: stepInput, scorePolicy: input.policy },
    });
  const evaluation = assessor.output.evaluation;
  const gate = gateStep({
    id: `${input.id}.gate`,
    input: { evaluation },
    label: `Gate ${input.label ?? input.id}`,
    policy: input.policy,
  });
  const document = judgmentDocument(input, assessor, gate.id, evaluation);
  const built = authoredWorkflow({
    catalog: [assessor, gate],
    document,
    input: input.input,
    output: {
      decision: promptedOperationDecisionSchema,
      evaluation,
    },
  });
  const ejected = { assessor, document, gate, workflow: built };
  function eject(): EjectedJudgmentWorkflow<TInputContracts, TEvaluation>;
  function eject(options: EvaluationEjectOptions): EjectedJudgmentWorkflow<
    TInputContracts,
    TEvaluation
  > & EvaluationEjectWriteResult;
  function eject(options?: EvaluationEjectOptions) {
    if (!options) return ejected;
    if (!("evaluator" in input) || !input.evaluator) {
      throw new Error("Source ejection is only available for model-authored judgments.");
    }
    return Object.assign(ejected, ejectEvaluationSource({ document, options }));
  }
  return Object.assign(built, { assessor, eject, gate });
}

function authoredAssessor<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
>(
  id: string,
  assessor:
    | AuthoredStepDefinition<TInputContracts, { evaluation: TEvaluation }>
    | AuthoredWorkflow<TInputContracts, { evaluation: TEvaluation }>,
): AuthoredStepDefinition<TInputContracts, { evaluation: TEvaluation }> {
  return "definition" in assessor
    ? workflowStep({ id: `${id}.assess`, workflow: assessor })
    : assessor;
}

function judgmentDocument<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
  TPolicy extends CandidateScorePolicy,
>(
  input: AuthoredJudgeWorkflowInput<TInputContracts, TEvaluation, TPolicy>,
  assessor: AuthoredStepDefinition<TInputContracts, { evaluation: TEvaluation }>,
  gateId: string,
  evaluation: TEvaluation,
): WorkflowDocument {
  const workflowId = `${input.id}.evaluation`;
  return {
    description: input.description ?? `Judge ${input.label ?? input.id}.`,
    edges: [
      { id: "trigger-to-assess", source: "trigger", target: "assess" },
      { id: "assess-to-gate", source: "assess", target: "gate" },
      { id: "gate-to-end", source: "gate", target: "end" },
    ],
    end: {
      id: "end",
      label: "Judgment completed",
      output: {
        decision: { jsonSchema: jsonSchemaFromContractSource(promptedOperationDecisionSchema) },
        evaluation: { jsonSchema: jsonSchemaFromContractSource(evaluation) },
      },
      type: "result",
    },
    id: workflowId,
    label: input.label ? `${input.label} judgment` : workflowId,
    nodes: [
      { catalogItemId: assessor.id, id: "assess", kind: assessor.kind, label: "Assess", role: "judge" },
      { catalogItemId: gateId, id: "gate", kind: "gate", label: "Gate", role: "gate" },
    ],
    trigger: {
      id: "trigger",
      input: Object.fromEntries(Object.entries(input.input).map(([key, contract]) => [
        key,
        { jsonSchema: jsonSchemaFromContractSource(contract) },
      ])),
      label: "Judgment input",
      type: "manual",
    },
    version: 1,
  };
}
