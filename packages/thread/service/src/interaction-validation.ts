import { Ajv } from "ajv";
import type { DromioJsonObject, DromioJsonValue, DromioToolCallItem } from "@dromio/protocols";
import { ThreadServiceError } from "./errors.js";

const ajv = new Ajv({ allErrors: true, strict: false });

export async function validateApprovalBinding(input: {
  readonly operation: string;
  readonly toolVersion: string;
  readonly capabilityId?: string;
  readonly argumentsDigest: string;
  readonly requestedPermissions: readonly string[];
}, tool: DromioToolCallItem | undefined, turnId: string): Promise<void> {
  if (!tool || tool.turnId !== turnId) invalid("Approval must reference a tool call in the same turn.");
  if (tool.toolId !== input.operation) invalid("Approval operation does not match the referenced tool call.");
  if (tool.toolVersion !== input.toolVersion) invalid("Approval tool version does not match the referenced tool call.");
  if (tool.capabilityId !== input.capabilityId) invalid("Approval capability does not match the referenced tool call.");
  if (await digest(tool.arguments) !== input.argumentsDigest) invalid("Approval arguments digest does not match the referenced tool call.");
  if (tool.status !== "running" && tool.status !== "proposed") invalid("Approval requires a tool call awaiting a decision.");
  if (!input.requestedPermissions.length || new Set(input.requestedPermissions).size !== input.requestedPermissions.length) invalid("Approval permissions must be non-empty and unique.");
}

export function validateAnswerSchema(schema: DromioJsonObject): void {
  try {
    ajv.compile(schema);
  } catch (error) {
    invalid(`Interaction answer schema is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function validateAnswer(schema: DromioJsonObject, answer: DromioJsonValue): void {
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    invalid(`Interaction answer schema is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!validate(answer)) invalid(`Interaction answer does not match its schema: ${ajv.errorsText(validate.errors)}`);
}

async function digest(value: DromioJsonObject): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function invalid(message: string): never {
  throw new ThreadServiceError({ code: "validation_failed", message });
}
