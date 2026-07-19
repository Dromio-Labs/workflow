import {
  TIMER_HOOK_KIND,
  type HookRequest,
} from "../core/index.js";
import type {
  RuntimeStoreEnqueueInput,
  TimerJobPayload,
} from "./types.js";
import type {
  WorkflowAppRunSnapshot,
} from "../client/interactions/workflow-app.js";

export const TIMER_TRIGGER_ID = "$timer";

export function timerJobsForRunSnapshot(input: {
  id: () => string;
  now: string;
  snapshot: WorkflowAppRunSnapshot;
}): RuntimeStoreEnqueueInput[] {
  return (input.snapshot.pendingHooks ?? [])
    .filter(isPendingTimerHook)
    .map((hook) => ({
      availableAt: hook.expiresAt,
      createdAt: input.now,
      id: input.id(),
      idempotencyKey: hook.token,
      kind: "timer",
      maxAttempts: 3,
      occurrenceId: hook.token,
      payload: {
        runId: input.snapshot.runId,
        source: "timer",
        token: hook.token,
      },
      status: "queued",
      triggerId: TIMER_TRIGGER_ID,
      updatedAt: input.now,
      workflowId: input.snapshot.workflowId,
    }));
}

export function requireTimerJobPayload(value: unknown): TimerJobPayload {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { source?: unknown }).source === "timer" &&
    typeof (value as { runId?: unknown }).runId === "string" &&
    typeof (value as { token?: unknown }).token === "string"
  ) {
    return value as TimerJobPayload;
  }
  throw new Error("Timer job payload must include runId and token.");
}

function isPendingTimerHook(
  hook: HookRequest,
): hook is HookRequest & { expiresAt: string; kind: typeof TIMER_HOOK_KIND } {
  return hook.kind === TIMER_HOOK_KIND && typeof hook.expiresAt === "string";
}
