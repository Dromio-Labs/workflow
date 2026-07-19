import type {
  WorkflowControlPlane,
  WorkflowRuntimeStore,
} from "./types.js";

export type RunSignalDeliveryPassInput = {
  controlPlane: WorkflowControlPlane;
  leaseMs?: number;
  now?: () => Date;
  runtimeStore: WorkflowRuntimeStore;
  workerId: string;
};

export async function runSignalDeliveryPass(
  input: RunSignalDeliveryPassInput,
): Promise<boolean> {
  const clock = input.now ?? (() => new Date());
  const claimed = await input.runtimeStore.claimNextSignalDelivery({
    leaseMs: input.leaseMs ?? 30_000,
    now: clock().toISOString(),
    workerId: input.workerId,
  });
  if (!claimed) return false;

  try {
    const run = await input.controlPlane.getRun(claimed.wait.runId);
    const pending = run.pendingHooks?.some((hook) => hook.token === claimed.wait.token);
    if (pending) {
      await input.controlPlane.resumeHook({
        token: claimed.wait.token,
        value: {
          occurrenceId: claimed.occurrence.id,
          occurredAt: claimed.occurrence.occurredAt,
          payload: claimed.occurrence.payload,
        },
      });
    }
    await input.runtimeStore.completeSignalDelivery({
      now: clock().toISOString(),
      occurrenceId: claimed.occurrence.id,
      runId: claimed.wait.runId,
      waitToken: claimed.wait.token,
    });
    return true;
  } catch (error) {
    await input.runtimeStore.failSignalDelivery({
      error: error instanceof Error ? error.message : String(error),
      now: clock().toISOString(),
      occurrenceId: claimed.occurrence.id,
      retry: claimed.occurrence.attempts < 3,
    });
    throw error;
  }
}
