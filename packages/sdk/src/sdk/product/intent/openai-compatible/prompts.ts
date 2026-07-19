import {
  jsonSchemaFromContractSource,
} from "../../../core/prompted-operation/contracts.js";
import type {
  OpenAiCompatibleChatMessage,
  OpenAiCompatibleChatModelRequest,
} from "./types.js";

export function promptMessages(
  input: OpenAiCompatibleChatModelRequest,
): OpenAiCompatibleChatMessage[] {
  const messages: OpenAiCompatibleChatMessage[] = [];
  const jsonSchema = input.jsonSchema ?? (input.schema ? jsonSchemaFromContractSource(input.schema) : undefined);
  if (input.systemPrompt) {
    messages.push({
      content: withJsonSchemaInstruction(input.systemPrompt, jsonSchema),
      role: "system",
    });
  } else if (jsonSchema) {
    messages.push({
      content: withJsonSchemaInstruction("", jsonSchema),
      role: "system",
    });
  }
  if (input.userPrompt) {
    messages.push({ content: input.userPrompt, role: "user" });
  }
  return messages;
}

function withJsonSchemaInstruction(prompt: string, jsonSchema: unknown | undefined) {
  if (!jsonSchema) return prompt;
  return [
    prompt,
    "Return only JSON matching this JSON Schema:",
    JSON.stringify(jsonSchema, null, 2),
    "Do not include markdown, code fences, or prose outside the JSON.",
  ].filter(Boolean).join("\n");
}
