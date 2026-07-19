import type {
  OpenAiCompatibleChatInput,
} from "./types.js";

export function setupError(input: OpenAiCompatibleChatInput, cause: string) {
  return new Error(input.setupErrorMessage ? input.setupErrorMessage(cause) : cause);
}

export function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "request";
}
