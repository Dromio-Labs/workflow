import type {
  Question,
  QuestionConstraints,
  QuestionOption,
} from "../../core/questions/index.js";
import type { EventPayload } from "../../core/loop/index.js";

export type ProductIntentFieldType =
  | "string"
  | "number"
  | "boolean"
  | "duration"
  | "url"
  | "asset"
  | "enum";

export type ProductIntentField = {
  description: string;
  examples?: unknown[];
  required?: boolean;
  type?: ProductIntentFieldType;
  values?: string[];
};

export type ProductIntent<
  TId extends string = string,
  TFields extends Record<string, ProductIntentField> = Record<string, ProductIntentField>,
> = {
  description: string;
  examples?: string[];
  fields?: TFields;
  id: TId;
  title?: string;
};

export type Domain<
  TId extends string = string,
  TIntents extends readonly ProductIntent[] = readonly ProductIntent[],
> = {
  description?: string;
  id: TId;
  intent?: DomainIntentPolicy;
  intents: TIntents;
  title?: string;
};

export type DomainIntentPolicy = {
  baseUrl?: string;
  instructions?: string[];
  kind?: string;
  model?: string;
  provider?: string;
  questionConstraintsForRequirement?: (context: {
    contract: IntentContract;
    requirement: IntentRequirement;
  }) => QuestionConstraints | undefined;
  resolve?: <TDomain extends Domain>(
    input: ResolveIntentInput<TDomain>,
  ) => Promise<IntentContract<DomainIntentId<TDomain>>> | IntentContract<DomainIntentId<TDomain>>;
};

export type DomainIntentId<TDomain extends Domain> =
  TDomain["intents"][number]["id"];

export type {
  Question,
  QuestionConstraints,
  QuestionOption,
};

export type AnswerInput = {
  questionId: string;
  value: unknown;
};

export type IntentRequirementStatus =
  | "satisfied"
  | "missing"
  | "ambiguous"
  | "unsupported";

export type IntentRequirement = {
  id: string;
  label: string;
  question?: Question;
  required?: boolean;
  status: IntentRequirementStatus;
  type: ProductIntentFieldType | "unknown";
  value: unknown | null;
};

export type IntentStep<TIntentId extends string = string> = {
  id: string;
  intent: TIntentId;
  label: string;
  requirementIds: string[];
};

export type IntentContract<TIntentId extends string = string> = {
  kind: string;
  requirements: IntentRequirement[];
  steps: IntentStep<TIntentId>[];
};

export type IntentResolutionSnapshot<TIntentId extends string = string> = {
  contract: IntentContract<TIntentId>;
  questions: Question[];
  status: "resolved" | "needs_input" | "failed";
};

export type IntentResolutionSession<TIntentId extends string = string> =
  IntentResolutionSnapshot<TIntentId> & {
    answer(input: AnswerInput): Promise<IntentResolutionSnapshot<TIntentId>>;
    resume(): Promise<IntentResolutionSnapshot<TIntentId>>;
  };

export type ResolveIntentInput<TDomain extends Domain> = {
  answers?: Record<string, unknown>;
  baseUrl?: string;
  context?: string;
  domain: TDomain;
  model?: string;
  onEvent?: (event: EventPayload) => void | Promise<void>;
  prompt: string;
  provider?: string;
  resolver?: "llm" | DomainIntentPolicy["resolve"];
  trace?: {
    parentSpanId?: string;
    spanId?: string;
    traceId?: string;
  };
};
