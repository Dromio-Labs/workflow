import type {
  TraceAttributeValue,
} from "../../../core/index.js";
import {
  emitFailure,
  emitModelEvent,
  emitRetry,
  modelTrace,
} from "./events.js";
import {
  completeLocalChatEndpoint,
} from "./local-chat.js";
import {
  parseOpenAiCompatibleSse,
  readDeltaContent,
  readStreamedError,
} from "./sse.js";
import type {
  OpenAiCompatibleChatInput,
} from "./types.js";
import {
  setupError,
  slug,
} from "./utils.js";

export async function streamOpenAiCompatibleChatCompletion(
  input: OpenAiCompatibleChatInput,
): Promise<string> {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? 1));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await streamOpenAiCompatibleChatCompletionOnce(input);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const message = error instanceof Error ? error.message : String(error);
      await emitRetry(input, attempt, maxAttempts, message);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function streamOpenAiCompatibleChatCompletionOnce(
  input: OpenAiCompatibleChatInput,
): Promise<string> {
  const spanId = input.trace?.spanId ?? `model:${slug(input.operation)}`;
  const traceId = input.trace?.traceId ?? "provider";
  const attributes: Record<string, TraceAttributeValue> = {
    baseUrl: input.baseUrl,
    chatTransport: input.chatTransport ?? process.env.INTENT_CHAT_TRANSPORT ?? "fetch",
    chatUrl: input.chatUrl ?? process.env.INTENT_CHAT_URL ?? "",
    model: input.model,
    operation: input.operation,
    provider: input.provider,
  };
  await emitModelEvent(input, {
    detail: attributes,
    message: `Started ${input.operation}.`,
    trace: modelTrace({
      attributes,
      input,
      spanId,
      status: "unset",
      traceId,
    }),
    type: "model.request.started",
  });

  const chatUrl = input.chatUrl ?? process.env.INTENT_CHAT_URL;
  if (chatUrl) {
    return completeLocalChatEndpoint(input, chatUrl, spanId, traceId, attributes);
  }

  let response: Response;
  try {
    response = await fetch(`${input.baseUrl}/v1/chat/completions`, {
      body: JSON.stringify({
        ...input.body,
        stream: true,
      }),
      headers: {
        ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
        "content-type": "application/json",
        "x-llm-provider": input.provider,
      },
      method: "POST",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitFailure(input, spanId, traceId, attributes, message);
    throw setupError(input, message);
  }

  if (!response.ok) {
    const message = `provider returned ${response.status}: ${await response.text()}`;
    await emitFailure(input, spanId, traceId, attributes, message);
    throw setupError(input, message);
  }
  if (!response.body) {
    const message = "provider streaming response did not include a body";
    await emitFailure(input, spanId, traceId, attributes, message);
    throw setupError(input, message);
  }

  let content = "";
  let usage: unknown;
  try {
    for await (const chunk of parseOpenAiCompatibleSse(response.body)) {
      const streamedError = readStreamedError(chunk);
      if (streamedError) {
        throw new Error(streamedError);
      }
      usage = chunk.usage ?? usage;
      const delta = readDeltaContent(chunk);
      if (!delta) continue;
      content += delta;
      await emitModelEvent(input, {
        detail: {
          delta,
          length: delta.length,
        },
        message: `Received ${input.operation} delta.`,
        trace: modelTrace({
          attributes: {
            ...attributes,
            contentLength: content.length,
          },
          input,
          spanId,
          status: "unset",
          traceId,
        }),
        type: "model.response.delta",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitFailure(input, spanId, traceId, attributes, message);
    throw setupError(input, message);
  }

  if (!content.trim()) {
    const message = "provider stream completed without message content";
    await emitFailure(input, spanId, traceId, attributes, message);
    throw setupError(input, message);
  }

  await emitModelEvent(input, {
    detail: {
      contentLength: content.length,
      usage,
    },
    message: `Completed ${input.operation}.`,
    trace: modelTrace({
      attributes: {
        ...attributes,
        contentLength: content.length,
      },
      input,
      spanId,
      status: "ok",
      traceId,
    }),
    type: "model.response.completed",
  });
  return content;
}
