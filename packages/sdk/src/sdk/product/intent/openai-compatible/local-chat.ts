import type {
  TraceAttributeValue,
} from "../../../core/index.js";
import {
  emitFailure,
  emitModelEvent,
  modelTrace,
} from "./events.js";
import type {
  OpenAiCompatibleChatInput,
} from "./types.js";
import {
  setupError,
} from "./utils.js";

export async function completeLocalChatEndpoint(
  input: OpenAiCompatibleChatInput,
  chatUrl: string,
  spanId: string,
  traceId: string,
  attributes: Record<string, TraceAttributeValue>,
) {
  const prompt = localChatPromptFromBody(input.body);
  const payload = {
    input: prompt.input,
    model: localChatModel(input.model),
    system_prompt: prompt.systemPrompt,
  };
  let json: unknown;
  try {
    json = await requestLocalChatJson(input, chatUrl, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitFailure(input, spanId, traceId, attributes, message);
    throw setupError(input, message);
  }

  try {
    const content = readLocalChatContent(json);
    if (!content.trim()) {
      throw new Error("local chat provider completed without message content");
    }
    await emitModelEvent(input, {
      detail: {
        delta: content,
        length: content.length,
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
    await emitModelEvent(input, {
      detail: {
        contentLength: content.length,
        usage: readLocalChatUsage(json),
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitFailure(input, spanId, traceId, attributes, message);
    throw setupError(input, message);
  }
}

async function requestLocalChatJson(
  input: OpenAiCompatibleChatInput,
  chatUrl: string,
  payload: {
    input: string;
    model: string;
    system_prompt: string;
  },
) {
  const transport = input.chatTransport ?? process.env.INTENT_CHAT_TRANSPORT ?? "fetch";
  if (transport === "curl") {
    return requestLocalChatJsonWithCurl(chatUrl, payload);
  }
  const response = await fetch(chatUrl, {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`provider returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<unknown>;
}

async function requestLocalChatJsonWithCurl(
  chatUrl: string,
  payload: {
    input: string;
    model: string;
    system_prompt: string;
  },
) {
  const proc = Bun.spawn([
    "curl",
    "-sS",
    chatUrl,
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify(payload),
  ], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`curl exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`curl response was not JSON: ${message}; ${stdout.slice(0, 500)}`);
  }
}

function localChatPromptFromBody(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system: string[] = [];
  const user: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    const content = messageContent(record.content);
    if (!content) continue;
    if (record.role === "system") {
      system.push(content);
    } else {
      user.push(content);
    }
  }
  return {
    input: user.join("\n\n"),
    systemPrompt: system.join("\n\n"),
  };
}

function messageContent(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function localChatModel(model: string) {
  return model.startsWith("local:") ? model.slice("local:".length) : model;
}

function readLocalChatContent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  if (typeof record.message === "string") return record.message;
  if (record.message && typeof record.message === "object" && !Array.isArray(record.message)) {
    const content = (record.message as Record<string, unknown>).content;
    if (typeof content === "string") return content;
  }
  if (typeof record.output === "string") return record.output;
  if (Array.isArray(record.output)) {
    return record.output
      .flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const output = item as Record<string, unknown>;
        return output.type === "message" && typeof output.content === "string" ? [output.content] : [];
      })
      .join("\n");
  }
  return "";
}

function readLocalChatUsage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return record.stats ?? record.usage;
}
