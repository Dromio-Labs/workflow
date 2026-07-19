import {
  decisionFromEvaluation,
  evaluationBarFromPolicy,
  evaluationCompletedEvent,
  passingThreshold,
  promptedOperationDecisionSchema,
  promptedOperationEvaluationSchema,
  type CandidateScorePolicy,
  type OperationContractSourceLike,
  type PromptedOperationDecision,
  type PromptedOperationEvaluation,
  type StepContractSourceMap,
} from "../core/index.js";
import {
  baseStep,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";

export type AuthoredGateStepInput<
  TInputContracts extends StepContractSourceMap & { evaluation: OperationContractSourceLike },
  TPolicy extends CandidateScorePolicy,
> = Omit<
  AuthoredStepInput<TInputContracts, {
    decision: typeof promptedOperationDecisionSchema;
    evaluation: TInputContracts["evaluation"];
  }>,
  "implementation" | "input" | "kind" | "models" | "output" | "run"
> & {
  input: TInputContracts;
  policy: TPolicy;
};

export function gateStep<
  const TInputContracts extends StepContractSourceMap & { evaluation: OperationContractSourceLike },
  const TPolicy extends CandidateScorePolicy,
>(input: AuthoredGateStepInput<TInputContracts, TPolicy>): AuthoredStepDefinition<
  TInputContracts,
  {
    decision: typeof promptedOperationDecisionSchema;
    evaluation: TInputContracts["evaluation"];
  }
> {
  return baseStep({
    ...input,
    implementation: { kind: "builtin" },
    kind: "gate",
    output: {
      decision: promptedOperationDecisionSchema,
      evaluation: input.input.evaluation,
    },
    run(context) {
      const evaluation = promptedOperationEvaluationSchema.parse(
        context.input.evaluation,
      ) satisfies PromptedOperationEvaluation;
      const decision = decisionFromEvaluation({
        evaluation,
        scorePolicy: input.policy,
      }) satisfies PromptedOperationDecision;
      const threshold = passingThreshold(input.policy);
      const passed = decision.status === "completed" && decision.score >= threshold;
      context.emit({
        detail: { decision, evaluation, policy: input.policy },
        gateId: decision.gateId,
        message: `${input.label ?? input.id}: ${Math.round(decision.score * 100)}% ${passed ? "passed" : "did not pass"}.`,
        passed,
        policyId: input.policy.id,
        score: decision.score,
        stepId: context.step.id,
        threshold,
        type: "score.gate.completed",
      });
      context.emit(evaluationCompletedEvent({
        bar: evaluationBarFromPolicy({
          evaluation,
          label: input.label ?? input.id,
          policy: input.policy,
          subjectId: input.id,
        }),
        trace: {
          name: input.label ?? input.id,
          parentSpanId: `step:${context.step.id}:attempt:${context.step.attempt}`,
          spanId: `evaluation:${context.step.id}:attempt:${context.step.attempt}`,
          status: passed ? "ok" : "error",
          traceId: context.step.runId,
        },
      }));
      context.emit({
        detail: { decision },
        message: `${input.label ?? input.id} decision: ${decision.status}.`,
        stepId: context.step.id,
        type: "operation.decision.completed",
      });
      return { decision, evaluation: context.input.evaluation };
    },
  });
}
