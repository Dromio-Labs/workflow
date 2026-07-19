import path from "node:path";
import type {
  ValidateError,
  WorkflowValidateErrorCode,
  WorkflowValidateResult,
} from "./workflow-validate-types.js";

export function validateError(input: {
  code: WorkflowValidateErrorCode;
  details?: Record<string, unknown>;
  location: string;
  message: string;
  severity?: ValidateError["severity"];
}): ValidateError {
  return {
    code: input.code,
    ...(input.details ? { details: input.details } : {}),
    location: input.location,
    message: input.message,
    severity: input.severity ?? "error",
  };
}

export function dedupeErrors(errors: ValidateError[]): ValidateError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.code}:${error.location}:${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resultFor(cwd: string, filePath: string, input: {
  errors: ValidateError[];
  parsed: unknown;
}): WorkflowValidateResult {
  const id = isRecord(input.parsed) && typeof input.parsed.id === "string" && input.parsed.id.trim()
    ? input.parsed.id
    : path.basename(filePath, ".workflow.json");
  return {
    errors: dedupeErrors(input.errors),
    id,
    valid: !input.errors.some((error) => error.severity === "error"),
  };
}

export function relativeLocation(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath) || ".";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
