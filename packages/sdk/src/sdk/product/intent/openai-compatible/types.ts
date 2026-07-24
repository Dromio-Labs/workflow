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
  /** Cancels the provider request and any in-progress response-body read. */
  signal?: AbortSignal;
  setupErrorMessage?: (cause: string) => string;
  /** Total provider deadline across all attempts. Defaults to 120 seconds and is capped at 300 seconds. */
  timeoutMs?: number;
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
  /** Default provider deadline. INTENT_PROVIDER_TIMEOUT_MS is used when omitted. */
  timeoutMs?: number;
};

export type OpenAiCompatibleChatModelRequest = {
  body?: Record<string, unknown>;
  jsonSchema?: unknown;
  messages?: OpenAiCompatibleChatMessage[];
  onEvent?: (event: EventPayload) => void | Promise<void>;
  operation: string;
  schema?: OperationContractSourceLike;
  /** Cancels this completion without changing the model's default deadline. */
  signal?: AbortSignal;
  setupErrorMessage?: (cause: string) => string;
  systemPrompt?: string;
  /** Overrides the model's provider deadline for this completion. */
  timeoutMs?: number;
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
