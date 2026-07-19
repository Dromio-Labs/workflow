import type { JsonValue } from "../shared/json.js";
import type { WorkflowAppRunSnapshot } from "../client/interactions/workflow-app.js";
import type { SignalWaitSnapshot } from "./types.js";

export function signalWaitsForRunSnapshot(
  snapshot: WorkflowAppRunSnapshot,
  now: string,
): SignalWaitSnapshot[] {
  return (snapshot.pendingHooks ?? []).flatMap((hook) => {
    if (hook.kind !== "signal" || !isSignalHookInput(hook.input)) return [];
    return [{
      contractFingerprint: hook.input.contractFingerprint,
      correlation: hook.input.correlation,
      correlationHash: hook.input.correlationHash,
      createdAt: now,
      runId: snapshot.runId,
      signalId: hook.input.signalId,
      status: "pending" as const,
      stepId: hook.stepId,
      token: hook.token,
      updatedAt: now,
    }];
  });
}

function isSignalHookInput(value: unknown): value is {
  contractFingerprint: string;
  correlation: JsonValue;
  correlationHash: string;
  signalId: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.contractFingerprint === "string"
    && typeof record.correlationHash === "string"
    && typeof record.signalId === "string"
    && record.correlation !== undefined;
}
