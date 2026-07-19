import type {
  EventPayload,
} from "../../core/index.js";
import {
  type InferOperationContractSource,
  jsonSchemaFromContractSource,
  type OperationContractSourceLike,
} from "../../core/prompted-operation/contracts.js";

export type ModelWorkerTraceInput = {
  parentSpanId?: string;
  spanId?: string;
  traceId?: string;
};

export type ModelWorkerMessage = {
  content: string;
  role: "assistant" | "system" | "user";
};

export type ModelWorkerCompleteInput = {
  body?: Record<string, unknown>;
  jsonSchema?: unknown;
  messages?: ModelWorkerMessage[];
  onEvent?: (event: EventPayload) => void | Promise<void>;
  operation: string;
  schema?: OperationContractSourceLike;
  setupErrorMessage?: (cause: string) => string;
  systemPrompt?: string;
  trace?: ModelWorkerTraceInput;
  userPrompt?: string;
};

export type ModelWorkerPort = {
  complete(input: ModelWorkerCompleteInput): Promise<string>;
  completeJson<TSchema extends OperationContractSourceLike>(
    input: ModelWorkerCompleteInput & { schema: TSchema },
  ): Promise<InferOperationContractSource<TSchema>>;
  completeJson(input: ModelWorkerCompleteInput): Promise<unknown>;
};

export function modelWorkerJsonSchema(input: Pick<ModelWorkerCompleteInput, "jsonSchema" | "schema">) {
  return input.jsonSchema ?? (input.schema ? jsonSchemaFromContractSource(input.schema) : undefined);
}

export function withModelWorkerJsonSchemaInstruction(prompt: string, jsonSchema: unknown | undefined) {
  if (!jsonSchema) return prompt;
  return [
    prompt,
    "Return only JSON matching this JSON Schema:",
    JSON.stringify(jsonSchema, null, 2),
    "Do not include markdown, code fences, or prose outside the JSON.",
  ].filter(Boolean).join("\n");
}

export function modelWorkerPromptText(input: ModelWorkerCompleteInput) {
  const jsonSchema = modelWorkerJsonSchema(input);
  if (input.messages?.length) {
    return [
      withModelWorkerJsonSchemaInstruction("", jsonSchema),
      ...input.messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`),
    ].filter(Boolean).join("\n\n");
  }

  const systemPrompt = withModelWorkerJsonSchemaInstruction(input.systemPrompt ?? "", jsonSchema);
  return [
    systemPrompt ? `SYSTEM:\n${systemPrompt}` : "",
    input.userPrompt ? `USER:\n${input.userPrompt}` : "",
  ].filter(Boolean).join("\n\n");
}
