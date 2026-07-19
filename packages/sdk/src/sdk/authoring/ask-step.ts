import {
  ask,
  normalizeOperationContract,
  parseOperationContract,
  type InferOperationContractSource,
  type InferStepContractInput,
  type InferStepContractOutput,
  type OperationContractSourceLike,
  type Question,
  type StepContractSourceMap,
} from "../core/index.js";
import {
  baseStep,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";

type AskStepContext<
  TInputContracts extends StepContractSourceMap | undefined,
> = {
  input: InferStepContractInput<TInputContracts>;
};

type AnswerMappingContext<
  TInputContracts extends StepContractSourceMap | undefined,
  TAnswerContract extends OperationContractSourceLike,
> = AskStepContext<TInputContracts> & {
  answer: InferOperationContractSource<TAnswerContract>;
  question: Question;
};

export type AuthoredAskStepInput<
  TInputContracts extends StepContractSourceMap | undefined,
  TAnswerContract extends OperationContractSourceLike,
  TOutputContracts extends StepContractSourceMap | undefined,
> = Omit<
  AuthoredStepInput<TInputContracts, TOutputContracts>,
  "kind" | "run"
> & {
  answer: TAnswerContract;
  mapAnswer(
    context: AnswerMappingContext<TInputContracts, TAnswerContract>,
  ):
    | InferStepContractOutput<TOutputContracts>
    | Promise<InferStepContractOutput<TOutputContracts>>;
  question(context: AskStepContext<TInputContracts>): Question;
};

/**
 * Defines a visible workflow step that presents a human question and suspends
 * the run until a valid answer is received.
 *
 * Reaching this step always asks the question. Put clarity checks, policy
 * decisions, and skip branches in explicit workflow steps before it.
 * This is not an approval boundary or an external-signal wait.
 */
export function askStep<
  const TInputContracts extends StepContractSourceMap | undefined = undefined,
  const TAnswerContract extends OperationContractSourceLike = OperationContractSourceLike,
  const TOutputContracts extends StepContractSourceMap | undefined = undefined,
>(
  input: AuthoredAskStepInput<
    TInputContracts,
    TAnswerContract,
    TOutputContracts
  >,
): AuthoredStepDefinition<TInputContracts, TOutputContracts> {
  const answerContract = normalizeOperationContract(
    `${input.id}.answer`,
    input.answer,
  );

  return baseStep({
    ...input,
    kind: "question",
    sideEffects: input.sideEffects ?? ["human.input"],
    async run(context) {
      const question = input.question({ input: context.input });
      if (!(question.id in context.answers)) return ask(question);

      const answer = parseOperationContract(
        answerContract,
        context.answers[question.id],
      );
      return input.mapAnswer({ answer, input: context.input, question });
    },
  });
}
