import type {
  HookDefinition,
  SleepFiredValue,
  SleepOptions,
} from "./loop.types.js";

export const TIMER_HOOK_KIND = "timer";

export function sleep(
  options: SleepOptions,
): HookDefinition<SleepOptions, SleepFiredValue> {
  return {
    expiresAt: sleepExpiresAt(options),
    id: options.id ?? "sleep",
    kind: TIMER_HOOK_KIND,
  };
}

export function sleepExpiresAt(options: SleepOptions): string {
  const hasMs = typeof options.ms === "number";
  const hasUntil = options.until !== undefined;
  if (hasMs === hasUntil) {
    throw new Error("sleep requires exactly one of 'ms' or 'until'.");
  }
  if (hasMs) {
    if (!Number.isFinite(options.ms) || options.ms < 0) {
      throw new Error("sleep ms must be a finite non-negative number.");
    }
    return new Date(Date.now() + options.ms).toISOString();
  }
  const date = options.until instanceof Date
    ? options.until
    : new Date(options.until);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("sleep until must be a valid date.");
  }
  return date.toISOString();
}
