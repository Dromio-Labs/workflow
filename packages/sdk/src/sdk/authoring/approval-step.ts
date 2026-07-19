import type {
  JsonValue,
  WorkflowHookRenderHint,
} from "@dromio/workflow-room-protocol";
import {
  createHook,
  fail,
  jsonSchemaFromContractSource,
  normalizeOperationContract,
  parseOperationContract,
  type InferOperationContractSource,
  type InferStepContractInput,
  type InferStepContractOutput,
  type OperationContractSourceLike,
  type StepContractSourceMap,
} from "../core/index.js";
import {
  baseStep,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";

type ApprovalInputContext<TInputContracts extends StepContractSourceMap> = {
  input: InferStepContractInput<TInputContracts>;
};

type ApprovalDecisionContext<
  TInputContracts extends StepContractSourceMap,
  TDecision extends OperationContractSourceLike,
> = ApprovalInputContext<TInputContracts> & {
  decision: InferOperationContractSource<TDecision>;
};

export type AuthoredApprovalStepInput<
  TInputContracts extends StepContractSourceMap,
  TDecision extends OperationContractSourceLike,
  TOutputContracts extends StepContractSourceMap,
> = Omit<AuthoredStepInput<TInputContracts, TOutputContracts>, "kind" | "run"> & {
  decision: TDecision;
  hookId?: string;
  mapDecision(
    context: ApprovalDecisionContext<TInputContracts, TDecision>,
  ):
    | InferStepContractOutput<TOutputContracts>
    | Promise<InferStepContractOutput<TOutputContracts>>;
  reject?(
    context: ApprovalDecisionContext<TInputContracts, TDecision>,
  ): string | undefined;
  render?:
    | WorkflowHookRenderHint
    | ((context: ApprovalInputContext<TInputContracts>) => WorkflowHookRenderHint);
  request(context: ApprovalInputContext<TInputContracts>): JsonValue;
  title?: string;
};

/** Defines a typed human approval boundary over the durable hook runtime. */
export function approvalStep<
  const TInputContracts extends StepContractSourceMap,
  const TDecision extends OperationContractSourceLike,
  const TOutputContracts extends StepContractSourceMap,
>(
  input: AuthoredApprovalStepInput<TInputContracts, TDecision, TOutputContracts>,
): AuthoredStepDefinition<TInputContracts, TOutputContracts> {
  const decisionContract = normalizeOperationContract(`${input.id}.decision`, input.decision);
  return baseStep({
    ...input,
    implementation: input.implementation ?? { kind: "primitive" },
    kind: "approval",
    sideEffects: input.sideEffects ?? ["human.approval"],
    async run(context) {
      const inputContext = { input: context.input };
      const render = typeof input.render === "function"
        ? input.render(inputContext)
        : input.render ?? { kind: "approval" as const };
      const decisionValue = await context.waitFor(createHook<JsonValue, InferOperationContractSource<TDecision>>({
        id: input.hookId ?? input.id,
        kind: "approval",
        render,
        schema: jsonSchemaFromContractSource(input.decision),
        title: input.title ?? input.label,
      }), input.request(inputContext));
      const decision = parseOperationContract(decisionContract, decisionValue);
      const decisionContext = { decision, input: context.input };
      const rejection = input.reject?.(decisionContext);
      if (rejection) return fail(rejection);
      return input.mapDecision(decisionContext);
    },
  });
}
