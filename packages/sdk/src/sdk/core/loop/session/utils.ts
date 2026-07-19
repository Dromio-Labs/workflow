import type {
  LoopStatus,
  HookRequest,
  StepState,
} from "../loop.types.js";

export function mergeOutput(state: StepState, stepId: string, output: unknown) {
  state[stepId] = output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    Object.assign(state, output);
  }
}

export function createRunId() {
  return `run_${crypto.randomUUID()}`;
}

export function hookToken(
  runId: string,
  stepId: string,
  attempt: number,
  hookId: string,
  ordinal: number,
) {
  return [
    "hook",
    encodeTokenPart(runId),
    encodeTokenPart(stepId),
    String(attempt),
    String(ordinal),
    encodeTokenPart(hookId),
  ].join(":");
}

export function isTerminalStatus(status: LoopStatus) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function cloneSnapshot<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export class HookWaitSignal extends Error {
  constructor(readonly request: HookRequest) {
    super(`Waiting for hook ${request.id}.`);
  }
}

function encodeTokenPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
