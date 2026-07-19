import type {
  Domain,
  DomainIntentId,
  IntentContract,
  IntentRequirement,
  IntentRequirementStatus,
  IntentStep,
  ProductIntent,
  Question,
  QuestionConstraints,
  QuestionOption,
  ResolveIntentInput,
} from "./intent.types.js";
import {
  defineOperationContract,
  definePromptedOperation,
  passthroughOperationContract,
  runPromptedOperation,
} from "../../core/index.js";
import { parseJsonObjectFromText } from "./json-output.js";
import {
  localChatEndpointBaseUrl,
  streamOpenAiCompatibleChatCompletion,
} from "./openai-compatible.js";

export async function resolveContract<TDomain extends Domain>(
  input: ResolveIntentInput<TDomain>,
  answers: Record<string, unknown>,
): Promise<IntentContract<DomainIntentId<TDomain>>> {
  const resolverInput = { ...input, answers };
  return typeof input.resolver === "function"
    ? await input.resolver(resolverInput)
    : input.domain.intent?.resolve
      ? await input.domain.intent.resolve(resolverInput)
    : await createContractWithLlm(resolverInput);
}

export function renderProductIntentForPrompt(intent: ProductIntent) {
  return {
    description: intent.description,
    examples: intent.examples ?? [],
    fields: Object.entries(intent.fields ?? {}).map(([id, field]) => ({
      description: field.description,
      id,
      required: field.required ?? false,
      type: field.type ?? "string",
      values: field.values,
    })),
    id: intent.id,
  };
}

export function questionsForContract(contract: IntentContract): Question[] {
  return contract.requirements.flatMap((requirement) =>
    requirement.required && requirement.status !== "satisfied" && requirement.question
      ? [requirement.question]
      : [],
  );
}

export function attachQuestions<TIntentId extends string>(
  domain: Domain,
  contract: IntentContract<TIntentId>,
): IntentContract<TIntentId> {
  return {
    ...contract,
    requirements: contract.requirements.map((requirement) => {
      if (!requirement.required || requirement.status === "satisfied") {
        return requirement;
      }
      const constraints = domain.intent?.questionConstraintsForRequirement?.({ contract, requirement });
      if (requirement.question) {
        return {
          ...requirement,
          question: constrainQuestion(requirement.question, requirement, constraints),
        };
      }
      return {
        ...requirement,
        question: questionFromConstraints(requirement, constraints),
      };
    }),
  };
}

async function createContractWithLlm<TDomain extends Domain>(
  input: ResolveIntentInput<TDomain>,
): Promise<IntentContract<DomainIntentId<TDomain>>> {
  const env = process.env;
  const chatUrl = env.INTENT_CHAT_URL?.trim() || undefined;
  const baseUrl = (
    chatUrl
      ? localChatEndpointBaseUrl(chatUrl)
      : input.baseUrl
        ?? input.domain.intent?.baseUrl
        ?? env.INTENT_BASE_URL
  )?.replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Intent LLM resolver requires baseUrl in resolveIntent input, domain intent policy, INTENT_BASE_URL, or INTENT_CHAT_URL.");
  }
  const provider = input.provider
    ?? input.domain.intent?.provider
    ?? env.INTENT_PROVIDER
    ?? (chatUrl ? "local-chat" : await discoverProvider(baseUrl));
  const model = input.model
    ?? input.domain.intent?.model
    ?? env.INTENT_MODEL
    ?? (chatUrl ? "google/gemma-4-26b-a4b" : await discoverModel(baseUrl, provider));
  const operation = definePromptedOperation({
    execute(operationInput, context) {
      return streamOpenAiCompatibleChatCompletion({
        baseUrl,
        body: {
          messages: [
            {
              content: intentSystemPrompt(input.domain),
              role: "system",
            },
            {
              content: JSON.stringify(
                {
                  answers: operationInput.answers ?? {},
                  context: operationInput.context ?? "",
                  prompt: operationInput.prompt,
                },
                null,
                2,
              ),
              role: "user",
            },
          ],
          model,
        },
        chatUrl,
        maxAttempts: 6,
        model,
        onEvent: context.onEvent,
        operation: "Resolve intent",
        provider,
        setupErrorMessage: (cause) => `Intent LLM request failed: ${cause}`,
        trace: childModelTrace(context.trace),
      });
    },
    id: "product.intent.resolve",
    input: passthroughOperationContract<"product.intent.resolve.input", ResolveIntentInput<TDomain>>("product.intent.resolve.input"),
    label: "Resolve intent",
    output: defineOperationContract({
      id: "product.intent.resolve.output",
      parse: (value) => normalizeContract(input.domain, value),
    }),
    parseOutput: (rawOutput) => parseJsonObjectFromText(String(rawOutput), "intent LLM response"),
  });
  const result = await runPromptedOperation({
    input,
    onEvent: input.onEvent,
    operation,
    trace: input.trace,
  });
  return result.output;
}

function childModelTrace(trace: ResolveIntentInput<Domain>["trace"]) {
  return {
    parentSpanId: trace?.spanId ?? trace?.parentSpanId,
    spanId: trace?.spanId ? `${trace.spanId}:model` : undefined,
    traceId: trace?.traceId,
  };
}

function intentSystemPrompt(domain: Domain): string {
  return [
    "You turn user prompts into an intent contract.",
    "Return JSON only. Do not return markdown.",
    "Use only the product intent ids provided in the domain.",
    "Do not invent executable nodes or product actions.",
    "Represent unknown or missing user-provided values as requirements with status 'missing' and value null.",
    ...(domain.intent?.instructions ?? []),
    "Use this exact JSON shape:",
    JSON.stringify(
      {
        kind: domain.intent?.kind ?? "intent_contract",
        requirements: [
          {
            id: "requirement_id",
            label: "Requirement label",
            question: {
              id: "requirement_id",
              prompt: "Contextual question to ask the user when this requirement is missing or ambiguous.",
              requirementId: "requirement_id",
              title: "Short question title",
              type: "text",
            },
            required: true,
            status: "satisfied",
            type: "string",
            value: "value from the prompt",
          },
        ],
        steps: [
          {
            id: "step_id",
            intent: "one_of_the_domain_intent_ids",
            label: "Step label",
            requirementIds: ["requirement_id"],
          },
        ],
      },
      null,
      2,
    ),
    "For every missing or ambiguous requirement, include a question object with natural wording based on the user's prompt.",
    "Do not hardcode values from examples into questions; ask only for the specific missing or ambiguous information.",
    "Question objects are only needed for requirements whose status is missing or ambiguous.",
    "Domain product intents:",
    JSON.stringify(domain.intents.map(renderProductIntentForPrompt), null, 2),
  ].join("\n\n");
}

async function discoverProvider(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/providers`);
  if (!response.ok) {
    throw new Error(`Provider discovery failed with ${response.status}.`);
  }
  const json = await response.json() as {
    data?: Array<{ id: string; isDefault?: boolean }>;
    defaultProvider?: string;
  };
  const provider = json.defaultProvider ?? json.data?.find((provider) => provider.isDefault)?.id ?? json.data?.[0]?.id;
  if (!provider) {
    throw new Error("Provider discovery returned no providers.");
  }
  return provider;
}

async function discoverModel(baseUrl: string, provider: string): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/models`);
  if (!response.ok) {
    throw new Error(`Model discovery failed with ${response.status}.`);
  }
  const json = await response.json() as {
    data?: Array<{ id: string; isDefault?: boolean; provider?: string }>;
  };
  const providerModels = (json.data ?? []).filter((model) => model.provider === provider || model.id.startsWith(`${provider}:`));
  const model = providerModels.find((model) => model.isDefault)?.id ?? providerModels[0]?.id ?? json.data?.[0]?.id;
  if (!model) {
    throw new Error("Model discovery returned no models.");
  }
  return model;
}

function normalizeContract<TDomain extends Domain>(
  domain: TDomain,
  value: unknown,
): IntentContract<DomainIntentId<TDomain>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Intent LLM returned a non-object contract.");
  }
  const record = value as Record<string, unknown>;
  const intentIds = new Set(domain.intents.map((intent) => intent.id));
  const requirements = Array.isArray(record.requirements)
    ? record.requirements.map(normalizeRequirement)
    : [];
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const steps = Array.isArray(record.steps)
    ? record.steps.flatMap((step, index) => normalizeStep(step, index, intentIds, requirementIds))
    : [];
  if (steps.length === 0) {
    throw new Error("Intent LLM returned no valid intent steps.");
  }
  return attachQuestions(domain, {
    kind: typeof record.kind === "string" ? record.kind : domain.intent?.kind ?? "intent_contract",
    requirements,
    steps: steps as IntentStep<DomainIntentId<TDomain>>[],
  });
}

function normalizeRequirement(value: unknown, index: number): IntentRequirement {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const status = normalizeStatus(record.status);
  return {
    id: typeof record.id === "string" && record.id ? record.id : `requirement_${index + 1}`,
    label: typeof record.label === "string" && record.label ? record.label : `Requirement ${index + 1}`,
    question: normalizeQuestion(record.question, typeof record.id === "string" ? record.id : `requirement_${index + 1}`),
    required: record.required !== false,
    status,
    type: normalizeRequirementType(record.type),
    value: status === "satisfied" ? record.value ?? null : record.value ?? null,
  };
}

function normalizeQuestion(value: unknown, requirementId: string): Question | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const type = record.type === "choice" || record.type === "multi" || record.type === "text" || record.type === "confirm"
    ? record.type
    : "text";
  const prompt = typeof record.prompt === "string" && record.prompt
    ? record.prompt
    : undefined;
  if (!prompt) {
    return undefined;
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : requirementId,
    options: Array.isArray(record.options)
      ? record.options.flatMap(normalizeQuestionOption)
      : undefined,
    prompt,
    requirementId: typeof record.requirementId === "string" && record.requirementId === requirementId
      ? record.requirementId
      : requirementId,
    title: typeof record.title === "string" ? record.title : undefined,
    type,
  };
}

function normalizeQuestionOption(value: unknown): QuestionOption[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string" || typeof record.value !== "string") {
    return [];
  }
  return [
    {
      description: typeof record.description === "string" ? record.description : undefined,
      label: record.label,
      value: record.value,
    },
  ];
}

function normalizeStep(
  value: unknown,
  index: number,
  intentIds: Set<string>,
  requirementIds: Set<string>,
): IntentStep[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const intent = typeof record.intent === "string" ? record.intent : "";
  if (!intentIds.has(intent)) {
    return [];
  }
  return [
    {
      id: typeof record.id === "string" && record.id ? record.id : `step_${index + 1}`,
      intent,
      label: typeof record.label === "string" && record.label ? record.label : `Step ${index + 1}`,
      requirementIds: Array.isArray(record.requirementIds)
        ? record.requirementIds.map(String).filter((id) => requirementIds.has(id))
        : [],
    },
  ];
}

function normalizeStatus(value: unknown): IntentRequirementStatus {
  return value === "satisfied" || value === "missing" || value === "ambiguous" || value === "unsupported"
    ? value
    : "missing";
}

function normalizeRequirementType(value: unknown): IntentRequirement["type"] {
  return value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "duration" ||
    value === "url" ||
    value === "asset" ||
    value === "enum"
    ? value
    : "unknown";
}

function constrainQuestion(
  question: Question,
  requirement: IntentRequirement,
  constraints?: QuestionConstraints,
): Question {
  const constrainedType = constraints?.type ?? question.type;
  return {
    ...question,
    resolverId: constraints?.resolverId ?? question.resolverId,
    id: constraints?.id ?? question.id,
    options: constraints?.options
      ? filterAllowedOptions(question.options, constraints.options)
      : question.options,
    requirementId: constraints?.requirementId ?? requirement.id,
    title: question.title ?? constraints?.title,
    type: constrainedType,
  };
}

function questionFromConstraints(
  requirement: IntentRequirement,
  constraints?: QuestionConstraints,
): Question | undefined {
  if (!constraints?.prompt) {
    return undefined;
  }
  return {
    id: constraints?.id ?? requirement.id,
    options: constraints?.options,
    prompt: constraints.prompt,
    requirementId: constraints?.requirementId ?? requirement.id,
    resolverId: constraints?.resolverId,
    title: constraints?.title ?? requirement.label,
    type: constraints?.type ?? "text",
  };
}

function filterAllowedOptions(
  llmOptions: QuestionOption[] | undefined,
  allowedOptions: QuestionOption[],
): QuestionOption[] {
  if (!llmOptions?.length) {
    return allowedOptions;
  }
  const allowed = new Map(allowedOptions.map((option) => [option.value, option]));
  const filtered = llmOptions.flatMap((option) => {
    const allowedOption = allowed.get(option.value);
    return allowedOption ? [{ ...allowedOption, label: option.label || allowedOption.label }] : [];
  });
  return filtered.length > 0 ? filtered : allowedOptions;
}
