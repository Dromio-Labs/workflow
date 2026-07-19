import type {
  QuestionResolution,
  QuestionResolutionInput,
  QuestionResolver,
} from "../../core/index.js";
import {
  defineOperationContract,
  definePromptedOperation,
  passthroughOperationContract,
  runPromptedOperation,
} from "../../core/index.js";
import { parseJsonObjectFromText } from "../intent/json-output.js";
import {
  localChatEndpointBaseUrl,
  streamOpenAiCompatibleChatCompletion,
} from "../intent/openai-compatible.js";

export type LlmQuestionResolverInput = {
  baseUrl?: string;
  id: string;
  instructions: string[];
  model?: string;
  operation?: string;
  provider?: string;
};

export function llmQuestionResolver(input: LlmQuestionResolverInput): QuestionResolver {
  return {
    id: input.id,
    async resolve(resolutionInput) {
      return resolveWithProvider(input, resolutionInput);
    },
  };
}

async function resolveWithProvider(
  config: LlmQuestionResolverInput,
  input: QuestionResolutionInput,
): Promise<QuestionResolution> {
  const chatUrl = process.env.INTENT_CHAT_URL?.trim() || undefined;
  const baseUrl = (
    chatUrl
      ? localChatEndpointBaseUrl(chatUrl)
      : config.baseUrl ??
        process.env.INTENT_BASE_URL ??
        "http://localhost:1111"
  ).replace(/\/$/, "");
  const provider = config.provider ??
    process.env.INTENT_PROVIDER ??
    (chatUrl ? "local-chat" : await discoverProvider(baseUrl));
  const model = config.model ??
    process.env.INTENT_MODEL ??
    (chatUrl ? "google/gemma-4-26b-a4b" : await discoverModel(baseUrl, provider));
  const operation = definePromptedOperation({
    execute(operationInput, context) {
      return streamOpenAiCompatibleChatCompletion({
        baseUrl,
        body: {
          messages: [
            {
              content: resolverSystemPrompt(config),
              role: "system",
            },
            {
              content: JSON.stringify({
                answers: operationInput.answers,
                history: operationInput.history ?? [],
                question: operationInput.question,
                state: operationInput.state,
                utterance: operationInput.utterance,
              }, null, 2),
              role: "user",
            },
          ],
          model,
        },
        chatUrl,
        maxAttempts: 6,
        model,
        onEvent: context.onEvent,
        operation: config.operation ?? `Resolve ${operationInput.question.id}`,
        provider,
        setupErrorMessage: (cause) => `Question resolver ${config.id} failed: ${cause}`,
        trace: childModelTrace(context.trace),
      });
    },
    id: `product.question.resolve.${config.id}`,
    input: passthroughOperationContract<"product.question.resolve.input", QuestionResolutionInput>("product.question.resolve.input"),
    label: config.operation ?? `Resolve ${input.question.id}`,
    output: defineOperationContract({
      id: "product.question.resolve.output",
      parse: normalizeResolution,
    }),
    parseOutput: (rawOutput) => parseJsonObjectFromText(String(rawOutput), "question resolver response"),
  });
  const result = await runPromptedOperation({
    input,
    onEvent: input.onEvent,
    operation,
    trace: input.trace,
  });
  return result.output;
}

function resolverSystemPrompt(input: LlmQuestionResolverInput) {
  return [
    "Resolve one active product question from the user's latest utterance.",
    "Use the history array as the local conversation memory for this unresolved question.",
    "If a previous history item suggested a value and the latest utterance approves it, accept with normalizedValue equal to that suggestedValue.",
    "If the latest utterance asks why a previous suggestion was made, answer briefly and keep status needs_input with kind suggestion or confirmation.",
    "Return JSON only. Do not return markdown.",
    "Do not expose private chain-of-thought. Return only public decision fields.",
    "Use one of these JSON shapes:",
    JSON.stringify({
      confidence: 0.9,
      kind: "answer",
      message: "Short product-facing explanation when useful.",
      normalizedValue: "value to store",
      status: "accepted",
    }, null, 2),
    JSON.stringify({
      confidence: 0.8,
      kind: "suggestion",
      message: "I suggest ./project-name. Please confirm or provide another path.",
      status: "needs_input",
      suggestedValue: "./project-name",
    }, null, 2),
    JSON.stringify({
      confidence: 0.9,
      kind: "revision",
      message: "This changes another scaffold field.",
      status: "revision",
      targetRequirementIds: ["requirement_id"],
    }, null, 2),
    JSON.stringify({
      confidence: 0.9,
      kind: "cancel",
      message: "The user cancelled.",
      status: "cancelled",
    }, null, 2),
    "status must be accepted, needs_input, revision, or cancelled.",
    "accepted kind must be answer, approve, or question.",
    "needs_input kind must be unclear, suggestion, or confirmation.",
    "revision kind must be revision and include targetRequirementIds.",
    "cancelled kind must be cancel.",
    "If accepted and kind is answer, include normalizedValue.",
    ...input.instructions,
  ].join("\n\n");
}

function normalizeResolution(value: unknown): QuestionResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Question resolver returned a non-object result.");
  }
  const record = value as Record<string, unknown>;
  const status = normalizeStatus(record.status, record.kind);
  const confidence = typeof record.confidence === "number" ? clamp(record.confidence) : 0.5;
  const message = typeof record.message === "string" ? record.message : undefined;
  if (status === "accepted") {
    return {
      confidence,
      kind: normalizeAcceptedKind(record.kind),
      message,
      normalizedValue: record.normalizedValue,
      status,
    };
  }
  if (status === "revision") {
    return {
      confidence,
      kind: "revision",
      message: message ?? "The answer requests a revision.",
      status,
      targetRequirementIds: Array.isArray(record.targetRequirementIds)
        ? record.targetRequirementIds.map(String).filter(Boolean)
        : [],
    };
  }
  if (status === "cancelled") {
    return {
      confidence,
      kind: "cancel",
      message,
      status,
    };
  }
  return {
    confidence,
    kind: normalizeNeedsInputKind(record.kind),
    message: message ?? "The answer needs clarification.",
    status: "needs_input",
    suggestedValue: record.suggestedValue,
  };
}

function normalizeStatus(value: unknown, kind: unknown): QuestionResolution["status"] {
  if (value === "accepted" || value === "needs_input" || value === "revision" || value === "cancelled") {
    return value;
  }
  if (kind === "revision") return "revision";
  if (kind === "cancel") return "cancelled";
  if (kind === "unclear" || kind === "suggestion" || kind === "confirmation") return "needs_input";
  return "accepted";
}

function normalizeAcceptedKind(value: unknown): "answer" | "approve" | "question" {
  if (value === "approve" || value === "question") return value;
  return "answer";
}

function normalizeNeedsInputKind(value: unknown): "unclear" | "suggestion" | "confirmation" {
  if (value === "suggestion" || value === "confirmation") return value;
  return "unclear";
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function childModelTrace(trace: QuestionResolutionInput["trace"]) {
  return {
    parentSpanId: trace?.spanId ?? trace?.parentSpanId,
    spanId: trace?.spanId ? `${trace.spanId}:model` : undefined,
    traceId: trace?.traceId,
  };
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
  const provider = json.defaultProvider ??
    json.data?.find((item) => item.isDefault)?.id ??
    json.data?.[0]?.id;
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
  const providerModels = (json.data ?? []).filter((model) =>
    model.provider === provider || model.id.startsWith(`${provider}:`)
  );
  const model = providerModels.find((item) => item.isDefault)?.id ??
    providerModels[0]?.id ??
    json.data?.[0]?.id;
  if (!model) {
    throw new Error("Model discovery returned no models.");
  }
  return model;
}
