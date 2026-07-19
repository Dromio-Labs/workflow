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
  workflow,
  type AuthoredWorkflow,
} from "./workflow.js";
import { workflowStep } from "./workflow-step.js";

type EvaluationOutputContracts<TEvaluation extends OperationContractSourceLike> = {
  decision: typeof promptedOperationDecisionSchema;
  evaluation: TEvaluation;
};

export type AuthoredEvaluateStepInput<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
  TPolicy extends CandidateScorePolicy,
> = {
  description?: string;
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
  id: string;
  input: TInputContracts;
  label?: string;
  policy: TPolicy;
};

export type EjectedEvaluationWorkflow<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = {
  assessor: AuthoredStepDefinition<TInputContracts, { evaluation: TEvaluation }>;
  document: WorkflowDocument;
  gate: AuthoredStepDefinition<
    { evaluation: TEvaluation },
    EvaluationOutputContracts<TEvaluation>
  >;
  workflow: AuthoredWorkflow<
    TInputContracts,
    EvaluationOutputContracts<TEvaluation>
  >;
};

export type AuthoredEvaluationStepDefinition<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = AuthoredStepDefinition<
  TInputContracts,
  EvaluationOutputContracts<TEvaluation>
> & {
  eject(): EjectedEvaluationWorkflow<TInputContracts, TEvaluation>;
  eject(options: EvaluationEjectOptions): EjectedEvaluationWorkflow<TInputContracts, TEvaluation>
    & EvaluationEjectWriteResult;
  readonly workflow: AuthoredWorkflow<
    TInputContracts,
    EvaluationOutputContracts<TEvaluation>
  >;
};

export function evaluateStep<
  const TInputContracts extends StepContractSourceMap,
  const TEvaluation extends OperationContractSourceLike,
  const TPolicy extends CandidateScorePolicy,
>(input: AuthoredEvaluateStepInput<
  TInputContracts,
  TEvaluation,
  TPolicy
>): AuthoredEvaluationStepDefinition<TInputContracts, TEvaluation> {
  const assessor = modelStep({
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
  const gate = gateStep({
    id: `${input.id}.gate`,
    input: input.evaluator.output,
    label: `Gate ${input.label ?? input.id}`,
    policy: input.policy,
  });
  const document = evaluationDocument(input, assessor.id, gate.id);
  const evaluationWorkflow = workflow({
    catalog: [assessor, gate],
    document,
    input: input.input,
    output: {
      decision: promptedOperationDecisionSchema,
      evaluation: input.evaluator.output.evaluation,
    },
  });
  const definition = workflowStep({
    description: input.description,
    id: input.id,
    kind: "evaluation",
    label: input.label,
    workflow: evaluationWorkflow,
  });
  const ejected = { assessor, document, gate, workflow: evaluationWorkflow };
  function eject(): EjectedEvaluationWorkflow<TInputContracts, TEvaluation>;
  function eject(options: EvaluationEjectOptions): EjectedEvaluationWorkflow<
    TInputContracts,
    TEvaluation
  > & EvaluationEjectWriteResult;
  function eject(options?: EvaluationEjectOptions) {
    return options
      ? Object.assign(ejected, ejectEvaluationSource({ document, options }))
      : ejected;
  }
  return Object.assign(definition, {
    eject,
    workflow: evaluationWorkflow,
  });
}

function evaluationDocument<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
  TPolicy extends CandidateScorePolicy,
>(
  input: AuthoredEvaluateStepInput<TInputContracts, TEvaluation, TPolicy>,
  assessorId: string,
  gateId: string,
): WorkflowDocument {
  const workflowId = `${input.id}.evaluation`;
  return {
    description: input.description ?? `Evaluate ${input.label ?? input.id}.`,
    edges: [
      { id: "trigger-to-assess", source: "trigger", target: "assess" },
      { id: "assess-to-gate", source: "assess", target: "gate" },
      { id: "gate-to-end", source: "gate", target: "end" },
    ],
    end: {
      id: "end",
      label: "Evaluation completed",
      output: {
        decision: { jsonSchema: jsonSchemaFromContractSource(promptedOperationDecisionSchema) },
        evaluation: { jsonSchema: jsonSchemaFromContractSource(input.evaluator.output.evaluation) },
      },
      type: "result",
    },
    id: workflowId,
    label: input.label ? `${input.label} evaluation` : workflowId,
    nodes: [
      { catalogItemId: assessorId, id: "assess", kind: "model", label: "Assess" },
      { catalogItemId: gateId, id: "gate", kind: "gate", label: "Gate" },
    ],
    trigger: {
      id: "trigger",
      input: Object.fromEntries(Object.entries(input.input).map(([key, contract]) => [
        key,
        { jsonSchema: jsonSchemaFromContractSource(contract) },
      ])),
      label: "Evaluation input",
      type: "manual",
    },
    version: 1,
  };
}
