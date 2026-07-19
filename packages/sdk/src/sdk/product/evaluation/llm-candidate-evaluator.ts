import type {
  CandidateEvaluation,
  CandidateEvaluationInput,
  CandidateEvaluator,
  CandidateEvaluationFinding,
  CandidateNextAction,
  CandidateScorePolicy,
  CandidateScorePolicyGapId,
  CandidateScorePolicyGateId,
  CandidateScorePolicyRiskId,
  CandidateScorePolicySatisfyId,
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
import {
  scorePolicyEvaluationPrompt,
} from "./score-policy-prompt.js";

export type LlmCandidateEvaluatorInput<TPolicy extends CandidateScorePolicy = CandidateScorePolicy> = {
  baseUrl?: string;
  id: string;
  instructions: string[];
  model?: string;
  operation?: string;
  provider?: string;
  scorePolicy?: TPolicy;
};

export function llmCandidateEvaluator<const TPolicy extends CandidateScorePolicy = CandidateScorePolicy>(
  input: LlmCandidateEvaluatorInput<TPolicy>,
): CandidateEvaluator<
  CandidateScorePolicySatisfyId<TPolicy>,
  CandidateScorePolicyGapId<TPolicy>,
  CandidateScorePolicyRiskId<TPolicy>,
  CandidateScorePolicyGateId<TPolicy>
> {
  return {
    id: input.id,
    async evaluate(evaluationInput) {
      return evaluateWithProvider(input, evaluationInput);
    },
  };
}

async function evaluateWithProvider(
  config: LlmCandidateEvaluatorInput,
  input: CandidateEvaluationInput,
): Promise<CandidateEvaluation> {
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
  const scorePolicy = config.scorePolicy ?? defaultCandidateScorePolicy;
  const operation = definePromptedOperation({
    execute(operationInput, context) {
      return streamOpenAiCompatibleChatCompletion({
        baseUrl,
        body: {
          messages: [
            {
              content: evaluatorSystemPrompt(config, scorePolicy),
              role: "system",
            },
            {
              content: JSON.stringify({
                candidate: operationInput.candidate,
                context: operationInput.context,
                intent: operationInput.intent,
                scorePolicy,
                state: operationInput.state,
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
        operation: config.operation ?? "Evaluate candidate",
        provider,
        setupErrorMessage: (cause) => `Candidate evaluator ${config.id} failed: ${cause}`,
        trace: childModelTrace(context.trace),
      });
    },
    id: `product.candidate.evaluate.${config.id}`,
    input: passthroughOperationContract<"product.candidate.evaluate.input", CandidateEvaluationInput>("product.candidate.evaluate.input"),
    label: config.operation ?? "Evaluate candidate",
    output: defineOperationContract({
      id: "product.candidate.evaluate.output",
      parse: (value) => normalizeCandidateEvaluation(value, scorePolicy),
    }),
    parseOutput: (rawOutput) => parseJsonObjectFromText(String(rawOutput), "candidate evaluator response"),
  });
  const result = await runPromptedOperation({
    input,
    onEvent: input.onEvent,
    operation,
    trace: input.trace,
  });
  return result.output;
}

const defaultCandidateScorePolicy = {
  gaps: [
    {
      description: "The candidate does not satisfy the intent.",
      id: "candidate-gap",
      severity: "medium",
    },
  ],
  gates: [
    {
      id: "candidate-pass",
      minScore: 0.8,
      nextAction: "confirm",
      status: "pass",
    },
    {
      id: "candidate-revise",
      minScore: 0,
      nextAction: "revise",
      status: "revise",
    },
  ],
  id: "score.candidate",
  risks: [],
  satisfies: [
    {
      description: "The candidate output is aligned with the intent.",
      id: "candidate-fit",
    },
  ],
} satisfies CandidateScorePolicy;

function evaluatorSystemPrompt(
  input: LlmCandidateEvaluatorInput,
  scorePolicy: CandidateScorePolicy,
) {
  return scorePolicyEvaluationPrompt({
    instructions: [
      "Evaluate whether the candidate output satisfies the user's original intent.",
      "Use this exact JSON shape:",
      JSON.stringify({
        gaps: [{ id: "missing-field", message: "What is missing.", severity: "medium" }],
        gateId: "gate-id-from-policy",
        message: "Short public explanation.",
        nextAction: "confirm",
        risks: [{ id: "risk-id", message: "What might go wrong.", severity: "low" }],
        satisfies: [{ id: "project_name", passed: true, reason: "Project name is resolved." }],
        score: 0.91,
        scorePolicyId: scorePolicy.id,
        status: "pass",
      }, null, 2),
      "status must be pass, needs_input, revise, or fail.",
      "nextAction must be ask, suggest, confirm, revise, execute, complete, or cancel.",
      "Use gaps for missing decisions and risks for known caveats.",
      ...input.instructions,
    ],
    scorePolicy,
    subject: "the candidate output",
  });
}

function normalizeCandidateEvaluation(
  value: unknown,
  policy: CandidateScorePolicy | undefined,
): CandidateEvaluation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Candidate evaluator returned a non-object result.");
  }
  const record = value as Record<string, unknown>;
  const score = typeof record.score === "number" ? clamp(record.score) : 0;
  const gate = normalizeGate(record.gateId, score, policy);
  const status = gate?.status ?? normalizeStatus(record.status);
  return {
    gaps: normalizeFindings(record.gaps),
    gateId: gate?.id,
    message: typeof record.message === "string" ? record.message : undefined,
    nextAction: gate?.nextAction ?? normalizeNextAction(record.nextAction),
    risks: normalizeFindings(record.risks),
    satisfies: Array.isArray(record.satisfies)
      ? record.satisfies.flatMap((item) => normalizeSatisfied(item))
      : [],
    score,
    scorePolicyId: typeof record.scorePolicyId === "string" ? record.scorePolicyId : policy?.id,
    status,
  };
}

function normalizeSatisfied(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [{
    id: typeof record.id === "string" ? record.id : "unknown",
    passed: record.passed === true,
    reason: typeof record.reason === "string" ? record.reason : "",
  }];
}

function normalizeFindings(value: unknown): CandidateEvaluationFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return [{
      id: typeof record.id === "string" ? record.id : "finding",
      message: typeof record.message === "string" ? record.message : "",
      severity: record.severity === "high" || record.severity === "medium" || record.severity === "low"
        ? record.severity
        : "medium",
    }];
  });
}

function normalizeStatus(value: unknown, fallback?: CandidateEvaluation["status"]): CandidateEvaluation["status"] {
  if (value === "pass" || value === "needs_input" || value === "revise" || value === "fail") return value;
  return fallback ?? "revise";
}

function normalizeNextAction(value: unknown, fallback?: CandidateNextAction): CandidateNextAction {
  if (
    value === "ask" ||
    value === "suggest" ||
    value === "confirm" ||
    value === "revise" ||
    value === "execute" ||
    value === "complete" ||
    value === "cancel"
  ) {
    return value;
  }
  return fallback ?? "confirm";
}

function normalizeGate(value: unknown, score: number, policy: CandidateScorePolicy | undefined) {
  const gates = policy?.gates ?? [];
  const scored = [...gates]
    .sort((left, right) => right.minScore - left.minScore)
    .find((gate) => score >= gate.minScore);
  if (scored) return scored;
  const explicit = typeof value === "string"
    ? gates.find((gate) => gate.id === value)
    : undefined;
  if (explicit) return explicit;
  return undefined;
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function childModelTrace(trace: CandidateEvaluationInput["trace"]) {
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
