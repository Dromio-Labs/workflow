import {
  attachQuestions,
  questionsForContract,
  resolveContract,
} from "./resolution.js";
import type {
  AnswerInput,
  Domain,
  DomainIntentId,
  IntentContract,
  IntentResolutionSession,
  IntentResolutionSnapshot,
  ProductIntent,
  ProductIntentField,
  ResolveIntentInput,
} from "./intent.types.js";

export { renderProductIntentForPrompt } from "./resolution.js";

export function intent<
  const TId extends string,
  const TFields extends Record<string, ProductIntentField> = Record<string, ProductIntentField>,
>(input: {
  description: string;
  examples?: string[];
  fields?: TFields;
  id: TId;
  title?: string;
}): ProductIntent<TId, TFields> {
  return input;
}

export function domain<
  const TId extends string,
  const TIntents extends readonly ProductIntent[],
>(input: {
  description?: string;
  id: TId;
  intent?: Domain<TId, TIntents>["intent"];
  intents: TIntents;
  title?: string;
}): Domain<TId, TIntents> {
  return input;
}

export async function resolveIntent<const TDomain extends Domain>(
  input: ResolveIntentInput<TDomain>,
): Promise<IntentResolutionSession<DomainIntentId<TDomain>>> {
  const contract = await resolveContract(input, input.answers ?? {});
  return new IntentResolutionSessionImpl(input, contract);
}

class IntentResolutionSessionImpl<TDomain extends Domain>
  implements IntentResolutionSession<DomainIntentId<TDomain>>
{
  private readonly answers: Record<string, unknown>;
  private contractValue: IntentContract<DomainIntentId<TDomain>>;

  constructor(
    private readonly input: ResolveIntentInput<TDomain>,
    contract: IntentContract<DomainIntentId<TDomain>>,
  ) {
    this.answers = { ...(input.answers ?? {}) };
    this.contractValue = contract;
    this.applyAnswers();
  }

  get contract() {
    return this.contractValue;
  }

  get questions() {
    return questionsForContract(this.contractValue);
  }

  get status() {
    return this.questions.length > 0 ? "needs_input" : "resolved";
  }

  async answer(input: AnswerInput) {
    this.answers[input.questionId] = input.value;
    await this.resolveWithAnswers();
    return this.snapshot();
  }

  async resume() {
    await this.resolveWithAnswers();
    return this.snapshot();
  }

  private snapshot(): IntentResolutionSnapshot<DomainIntentId<TDomain>> {
    return {
      contract: this.contractValue,
      questions: this.questions,
      status: this.status,
    };
  }

  private async resolveWithAnswers() {
    this.contractValue = await resolveContract(this.input, this.answers);
    this.applyAnswers();
  }

  private applyAnswers() {
    this.contractValue = {
      ...this.contractValue,
      requirements: this.contractValue.requirements.map((requirement) => {
        if (!(requirement.id in this.answers)) {
          return requirement;
        }
        const value = this.answers[requirement.id];
        return {
          ...requirement,
          question: undefined,
          status: "satisfied",
          value,
        };
      }),
    };
    this.contractValue = attachQuestions(this.input.domain, this.contractValue);
  }
}
