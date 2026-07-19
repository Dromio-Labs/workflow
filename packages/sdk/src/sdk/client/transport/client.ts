import type {
  CreateIntentClientInput,
  IntentClient,
} from "./client.types.js";
import { createHttpClient } from "./http-client.js";
import { createRuntimeClient } from "./runtime-client.js";

export function createClient(input: CreateIntentClientInput): IntentClient {
  if ("runtime" in input) return createRuntimeClient(input.runtime);
  return createHttpClient(input);
}
