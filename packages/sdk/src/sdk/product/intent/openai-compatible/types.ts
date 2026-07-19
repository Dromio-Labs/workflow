import type {
  EventPayload,
} from "../../../core/index.js";
import type {
  InferOperationContractSource,
  OperationContractSourceLike,
} from "../../../core/prompted-operation/contracts.js";

export type OpenAiCompatibleTraceInput = {
  parentSpanId?: string;
  spanId?: string;
  traceId?: string;
};

export type OpenAiCompatibleChatInput = {
  apiKey?: string;
  baseUrl: string;
  body: Record<string, unknown>;
  chatTransport?: "curl" | "fetch";
  chatUrl?: string;
  maxAttempts?: number;
  model: string;
  onEvent?: (event: EventPayload) => void | Promise<void>;
  operation: string;
  provider: string;
  setupErrorMessage?: (cause: string) => string;
  trace?: OpenAiCompatibleTraceInput;
};

export type OpenAiCompatibleChatMessage = {
  content: string;
  role: "assistant" | "system" | "user";
};

export type OpenAiCompatibleChatModelConfig = {
  apiKey?: string;
  baseUrl?: string;
  chatTransport?: "curl" | "fetch";
  chatUrl?: string;
  maxAttempts?: number;
  model?: string;
  provider?: string;
  temperature?: number;
};

export type OpenAiCompatibleChatModelRequest = {
  body?: Record<string, unknown>;
  jsonSchema?: unknown;
  messages?: OpenAiCompatibleChatMessage[];
  onEvent?: (event: EventPayload) => void | Promise<void>;
  operation: string;
  schema?: OperationContractSourceLike;
  setupErrorMessage?: (cause: string) => string;
  systemPrompt?: string;
  trace?: OpenAiCompatibleTraceInput;
  userPrompt?: string;
};

export type OpenAiCompatibleChatModel = {
  complete(input: OpenAiCompatibleChatModelRequest): Promise<string>;
  completeJson<TSchema extends OperationContractSourceLike>(
    input: OpenAiCompatibleChatModelRequest & { schema: TSchema },
  ): Promise<InferOperationContractSource<TSchema>>;
  completeJson(input: OpenAiCompatibleChatModelRequest): Promise<unknown>;
};
