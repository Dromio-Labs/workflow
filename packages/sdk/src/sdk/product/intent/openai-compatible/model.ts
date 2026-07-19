import {
  normalizeOperationContract,
  parseOperationContract,
} from "../../../core/prompted-operation/contracts.js";
import { parseJsonObjectFromText } from "../json-output.js";
import {
  resolveOpenAiCompatibleChatModelConfig,
} from "./config.js";
import {
  promptMessages,
} from "./prompts.js";
import {
  streamOpenAiCompatibleChatCompletion,
} from "./stream.js";
import type {
  OpenAiCompatibleChatModel,
  OpenAiCompatibleChatModelConfig,
  OpenAiCompatibleChatModelRequest,
} from "./types.js";
import {
  slug,
} from "./utils.js";

export function createOpenAiCompatibleChatModel(
  config: OpenAiCompatibleChatModelConfig = {},
): OpenAiCompatibleChatModel {
  const resolved = resolveOpenAiCompatibleChatModelConfig(config);

  return {
    complete(input: OpenAiCompatibleChatModelRequest) {
      return streamOpenAiCompatibleChatCompletion({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        body: {
          messages: input.messages ?? promptMessages(input),
          model: resolved.model,
          temperature: resolved.temperature,
          ...(input.body ?? {}),
        },
        chatTransport: resolved.chatTransport,
        chatUrl: resolved.chatUrl,
        maxAttempts: resolved.maxAttempts,
        model: resolved.model,
        onEvent: input.onEvent,
        operation: input.operation,
        provider: resolved.provider,
        setupErrorMessage: input.setupErrorMessage ?? ((cause) => `${input.operation} failed: ${cause}`),
        trace: input.trace,
      });
    },
    async completeJson(input: OpenAiCompatibleChatModelRequest) {
      const json = parseJsonObjectFromText(await this.complete(input), input.operation);
      if (!input.schema) return json;
      return parseOperationContract(
        normalizeOperationContract(`${slug(input.operation)}.response`, input.schema),
        json,
      );
    },
  };
}
