import {
  computeNextRunTime,
} from "@dromio/workflow-kernel";
import type {
  Clock,
  TriggerDescriptor,
  WorkflowControlPlane,
} from "./types.js";

export type RunScheduleTriggerPassInput = {
  clock?: Clock;
  controlPlane: Pick<
    WorkflowControlPlane,
    "enqueueScheduledTriggerOccurrence" | "listTriggers"
  >;
};

export type ScheduleTriggerPassResult = {
  enqueued: number;
  seen: number;
};

export async function runScheduleTriggerPass(
  input: RunScheduleTriggerPassInput,
): Promise<ScheduleTriggerPassResult> {
  const now = input.clock?.now() ?? new Date();
  const triggers = (await input.controlPlane.listTriggers()).filter(isEnabledScheduleTrigger);
  let enqueued = 0;

  for (const trigger of triggers) {
    const timezone = typeof trigger.config.timezone === "string"
      ? trigger.config.timezone
      : "UTC";
    // Catch-up policy: missed past occurrences are not backfilled; each pass only materializes the next future occurrence.
    const occurrence = computeNextRunTime(trigger.config.cron, timezone, now);
    if (!occurrence || occurrence.getTime() <= now.getTime()) continue;

    const occurrenceISO = occurrence.toISOString();
    const result = await input.controlPlane.enqueueScheduledTriggerOccurrence({
      availableAt: occurrenceISO,
      idempotencyKey: scheduleIdempotencyKey(trigger.id, occurrenceISO),
      occurrenceId: occurrenceISO,
      triggerId: trigger.id,
    });
    if (result.created) enqueued += 1;
  }

  return {
    enqueued,
    seen: triggers.length,
  };
}

export function scheduleIdempotencyKey(
  triggerId: string,
  occurrenceISO: string,
): string {
  return `sched:${triggerId}:${occurrenceISO}`;
}

type EnabledScheduleTrigger = TriggerDescriptor & {
  config: TriggerDescriptor["config"] & {
    cron: string;
  };
};

function isEnabledScheduleTrigger(
  trigger: TriggerDescriptor,
): trigger is EnabledScheduleTrigger {
  return trigger.type === "schedule" &&
    trigger.enabled &&
    typeof trigger.config?.cron === "string" &&
    trigger.config.cron.trim().length > 0;
}
