import type {
  CandidateScorePolicy,
  OperationContractSourceLike,
  StepContractSourceMap,
} from "../core/index.js";
import {
  judgeWorkflow,
  type AuthoredModelJudgeWorkflowInput,
  type EjectedJudgmentWorkflow,
} from "./judge-workflow.js";
import type { EvaluationEjectOptions, EvaluationEjectWriteResult } from "./evaluation-eject.js";
import type { AuthoredStepDefinition } from "./step.js";
import { workflowStep } from "./workflow-step.js";

export type AuthoredEvaluateStepInput<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
  TPolicy extends CandidateScorePolicy,
> = AuthoredModelJudgeWorkflowInput<TInputContracts, TEvaluation, TPolicy>;

export type EjectedEvaluationWorkflow<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = EjectedJudgmentWorkflow<TInputContracts, TEvaluation>;

export type AuthoredEvaluationStepDefinition<
  TInputContracts extends StepContractSourceMap,
  TEvaluation extends OperationContractSourceLike,
> = AuthoredStepDefinition<
  TInputContracts,
  EjectedJudgmentWorkflow<TInputContracts, TEvaluation>["workflow"]["output"]
> & {
  eject(): EjectedEvaluationWorkflow<TInputContracts, TEvaluation>;
  eject(options: EvaluationEjectOptions): EjectedEvaluationWorkflow<TInputContracts, TEvaluation>
    & EvaluationEjectWriteResult;
  readonly workflow: EjectedJudgmentWorkflow<TInputContracts, TEvaluation>["workflow"];
};

/**
 * Builds the legacy placeable evaluation step.
 *
 * @deprecated Use `workflow.judge()` and place it with `step.workflow()`.
 */
export function evaluateStep<
  const TInputContracts extends StepContractSourceMap,
  const TEvaluation extends OperationContractSourceLike,
  const TPolicy extends CandidateScorePolicy,
>(input: AuthoredEvaluateStepInput<
  TInputContracts,
  TEvaluation,
  TPolicy
>): AuthoredEvaluationStepDefinition<TInputContracts, TEvaluation> {
  const judgment = judgeWorkflow(input);
  const definition = workflowStep({
    description: input.description,
    id: input.id,
    kind: "evaluation",
    label: input.label,
    workflow: judgment,
  });
  return Object.assign(definition, {
    eject: judgment.eject,
    workflow: judgment,
  });
}
