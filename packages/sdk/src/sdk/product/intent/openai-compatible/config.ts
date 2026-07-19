import type {
  OpenAiCompatibleChatModelConfig,
} from "./types.js";

export type ResolvedOpenAiCompatibleChatModelConfig =
  Required<Omit<OpenAiCompatibleChatModelConfig, "apiKey" | "chatTransport" | "chatUrl">> & {
    apiKey?: string;
    chatTransport?: "curl" | "fetch";
    chatUrl?: string;
  };

export function resolveOpenAiCompatibleChatModelConfig(
  config: OpenAiCompatibleChatModelConfig,
): ResolvedOpenAiCompatibleChatModelConfig {
  const chatUrl = config.chatUrl ?? (process.env.INTENT_CHAT_URL?.trim() || undefined);
  const apiKey = config.apiKey ?? (process.env.OPENAI_API_KEY?.trim() || undefined);
  const baseUrl = config.baseUrl ??
    (chatUrl ? localChatEndpointBaseUrl(chatUrl) : process.env.INTENT_BASE_URL?.trim());
  const model = config.model ?? process.env.INTENT_MODEL?.trim();
  const provider = config.provider ?? process.env.INTENT_PROVIDER?.trim() ?? (chatUrl ? "local-chat" : "openai-compatible");
  const envTransport = process.env.INTENT_CHAT_TRANSPORT?.trim();
  const chatTransport = config.chatTransport ?? (envTransport === "curl" || envTransport === "fetch" ? envTransport : undefined);

  if (!baseUrl) {
    throw new Error("OpenAI-compatible chat model requires baseUrl, INTENT_BASE_URL, or INTENT_CHAT_URL.");
  }
  if (!model) {
    throw new Error("OpenAI-compatible chat model requires model or INTENT_MODEL.");
  }

  return {
    apiKey,
    baseUrl,
    chatTransport,
    chatUrl,
    maxAttempts: config.maxAttempts ?? 2,
    model,
    provider,
    temperature: config.temperature ?? 0.2,
  };
}

export function localChatEndpointBaseUrl(chatUrl: string) {
  try {
    return new URL(chatUrl).origin;
  } catch {
    return chatUrl.replace(/\/api\/v1\/chat\/?$/, "").replace(/\/$/, "");
  }
}
