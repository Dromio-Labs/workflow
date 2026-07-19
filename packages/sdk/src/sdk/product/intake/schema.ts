import { z } from "zod";
import {
  defineOperationContract,
  jsonSchemaFromContractSource,
  normalizeOperationContract,
  parseOperationContract,
  type OperationContract,
  type OperationContractSourceLike,
} from "../../core/prompted-operation/index.js";

export const requestIntakeQuestionOptionSchema = z.preprocess(normalizeQuestionOptionInput, z.object({
  description: z.string().trim().optional(),
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
}));

export const requestIntakeAnsweredQuestionSchema = z.object({
  answer: z.string().trim().min(1),
  id: z.string().trim().min(1),
  key: z.string().trim().min(1),
  question: z.string().trim().min(1),
});

export const requestIntakePromptSchema = z.string().trim().min(1);

export const requestIntakeRequestSchema = z.object({
  assumptions: z.array(z.string().trim().min(1)),
  clarifiedPrompt: z.string().trim().min(1),
  constraints: z.array(z.string().trim().min(1)),
  originalPrompt: z.string().trim().min(1),
  userAnswers: z.array(requestIntakeAnsweredQuestionSchema),
});

const requestIntakeQuestionBaseSchema = z.object({
  allowCustom: z.boolean().optional(),
  key: z.string().trim().min(1),
  options: z.array(requestIntakeQuestionOptionSchema).default([]),
  prompt: z.string().trim().min(1),
  title: z.string().trim().min(1),
  type: z.enum(["choice", "multi", "text", "confirm"]).default("text"),
});

export const requestIntakeQuestionSchema = z.preprocess(
  normalizeQuestionInput,
  requestIntakeQuestionBaseSchema,
);

export const requestIntakePendingQuestionSchema = z.preprocess(
  normalizeQuestionInput,
  requestIntakeQuestionBaseSchema.extend({
    id: z.string().trim().min(1),
  }),
);

export function createRequestIntakeResultSchema<TRequestSchema extends OperationContractSourceLike>(
  requestSchema: TRequestSchema,
  input: {
    requestContractId: string;
    resultContractId: string;
    maxQuestions?: number;
    normalizeRequest?: (request: unknown) => unknown;
  },
) {
  const requestContract = normalizeOperationContract(input.requestContractId, requestSchema);
  const shellSchema = z.object({
    questions: z.array(requestIntakeQuestionSchema).max(input.maxQuestions ?? 3).default([]),
    request: z.unknown(),
    status: z.enum(["needs_input", "ready"]),
    summary: z.string().trim().min(1),
  });
  return defineOperationContract({
    id: input.resultContractId,
    jsonSchema: requestIntakeResultJsonSchema(requestSchema, input),
    parse(value) {
      const shell = shellSchema.parse(value);
      return {
        ...shell,
        request: parseRequestWithFallback(requestContract, shell.request, input.normalizeRequest),
      };
    },
  });
}

export const requestIntakeEvaluationSchema = z.object({
  gateId: z.string().trim().min(1),
  message: z.string().trim().optional(),
  nextAction: z.enum(["complete", "revise", "ask", "cancel"]),
  questions: z.array(requestIntakeQuestionSchema).default([]),
  score: z.number().min(0).max(1),
  scorePolicyId: z.string().trim().optional(),
  status: z.enum(["pass", "revise", "needs_input", "fail"]),
});

function requestIntakeResultJsonSchema(
  requestSchema: OperationContractSourceLike,
  input: {
    maxQuestions?: number;
  },
) {
  const requestJsonSchema = jsonSchemaFromContractSource(requestSchema) ?? {};
  const shellJsonSchema = z.toJSONSchema(z.object({
    questions: z.array(requestIntakeQuestionSchema).max(input.maxQuestions ?? 3),
    request: z.unknown(),
    status: z.enum(["needs_input", "ready"]),
    summary: z.string(),
  })) as {
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };

  return {
    ...shellJsonSchema,
    properties: {
      ...(shellJsonSchema.properties ?? {}),
      request: requestJsonSchema,
    },
    required: [...new Set([...(shellJsonSchema.required ?? []), "request"])],
  };
}

function parseRequestWithFallback<TValue>(
  contract: OperationContract<TValue>,
  request: unknown,
  normalizeRequest?: (request: unknown) => unknown,
): TValue {
  try {
    return parseOperationContract(contract, request) as TValue;
  } catch (error) {
    if (!normalizeRequest) throw error;
    try {
      return parseOperationContract(contract, normalizeRequest(request)) as TValue;
    } catch {
      throw error;
    }
  }
}

function normalizeQuestionInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const prompt = stringValue(record.prompt) ?? stringValue(record.question);
  const title = stringValue(record.title) ?? stringValue(record.label) ?? prompt;
  const key = stringValue(record.key) ?? stringValue(record.id) ?? slugId(title ?? prompt ?? "question");
  return {
    ...record,
    key,
    options: Array.isArray(record.options) ? record.options : [],
    prompt,
    title,
  };
}

function normalizeQuestionOptionInput(value: unknown) {
  if (typeof value === "string") {
    const label = value.trim();
    return label ? { label, value: label } : value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const label = stringValue(record.label) ?? stringValue(record.value);
  const optionValue = stringValue(record.value) ?? label;
  return {
    ...record,
    label,
    value: optionValue,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function slugId(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "question";
}
