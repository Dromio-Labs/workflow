import { Ajv2020 } from "ajv/dist/2020.js";
import type { HookRequest } from "./loop.types.js";

const hookOutputValidator = new Ajv2020({ allErrors: true, strict: false });

export class HookOutputValidationError extends Error {
  constructor(
    readonly hookId: string,
    readonly validationMessage: string,
  ) {
    super(`Hook ${hookId} output does not match its schema: ${validationMessage}`);
    this.name = "HookOutputValidationError";
  }
}

/** Validates a hook response before its durable resume token is consumed. */
export function assertHookOutput(
  hook: Pick<HookRequest, "id" | "kind" | "schema">,
  value: unknown,
): void {
  // Signal hooks carry their signal descriptor in `schema`; payload validation
  // remains owned by the existing signal ingestion contract.
  if (hook.kind === "signal") return;
  if (!isJsonSchema(hook.schema)) return;
  const validate = hookOutputValidator.compile(hook.schema);
  if (validate(value)) return;
  throw new HookOutputValidationError(
    hook.id,
    hookOutputValidator.errorsText(validate.errors, { separator: "; " }),
  );
}

function isJsonSchema(value: unknown): value is boolean | Record<string, unknown> {
  if (typeof value === "boolean") return true;
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
