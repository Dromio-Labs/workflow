export const DEFAULT_LEASE_MS = 60_000;
export const DEFAULT_RECONCILE_LIMIT = 100;
export const DEFAULT_CANDIDATE_SCAN_LIMIT = 25;

export type LeaseRunStatus =
  | "cancelled"
  | "claimed"
  | "completed"
  | "dead"
  | "failed"
  | "queued"
  | "running";

export type ExpiredLeaseRequeuePatch = {
  claimedAt: null;
  heartbeatAt: null;
  leaseExpiresAt: null;
  nextAttemptAt: Date;
  status: Extract<LeaseRunStatus, "queued">;
  statusReason: string;
  updatedAt: Date;
  workerId: null;
};

export function retryDelayMsForAttempt(attempt: number): number {
  if (attempt <= 1) {
    return 10_000;
  }
  if (attempt === 2) {
    return 60_000;
  }
  return 300_000;
}

export function retryDelayMsAfterFailedAttempt(attempt: number): number {
  return retryDelayMsForAttempt(attempt);
}

export function leaseExpiresAt(now: Date, leaseMs = DEFAULT_LEASE_MS): Date {
  return new Date(now.getTime() + leaseMs);
}

export function failedRunStatusForAttempt(
  attempt: number,
  maxAttempts: number
): Extract<LeaseRunStatus, "dead" | "failed"> {
  return attempt >= maxAttempts ? "dead" : "failed";
}

export function expiredLeaseRequeuePatch(
  now: Date,
  reason = "Run lease expired; re-queued for worker recovery."
): ExpiredLeaseRequeuePatch {
  return {
    claimedAt: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    nextAttemptAt: now,
    status: "queued",
    statusReason: reason,
    updatedAt: now,
    workerId: null,
  };
}

export function positiveInteger(
  value: number | string | null | undefined
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}
