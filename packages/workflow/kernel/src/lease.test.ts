import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LEASE_MS,
  expiredLeaseRequeuePatch,
  failedRunStatusForAttempt,
  leaseExpiresAt,
  positiveInteger,
  retryDelayMsAfterFailedAttempt,
  retryDelayMsForAttempt,
} from "./lease";

describe("lease kernel", () => {
  test("uses retry delay tiers by attempt", () => {
    expect(retryDelayMsForAttempt(1)).toBe(10_000);
    expect(retryDelayMsForAttempt(2)).toBe(60_000);
    expect(retryDelayMsForAttempt(3)).toBe(300_000);
    expect(retryDelayMsForAttempt(12)).toBe(300_000);
    expect(retryDelayMsAfterFailedAttempt(2)).toBe(60_000);
  });

  test("computes lease expiration from a base time", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    expect(leaseExpiresAt(now).toISOString()).toBe(
      new Date(now.getTime() + DEFAULT_LEASE_MS).toISOString()
    );
    expect(leaseExpiresAt(now, 5_000).toISOString()).toBe(
      "2026-01-01T00:00:05.000Z"
    );
  });

  test("marks attempts at the max-attempt boundary as dead", () => {
    expect(failedRunStatusForAttempt(2, 3)).toBe("failed");
    expect(failedRunStatusForAttempt(3, 3)).toBe("dead");
    expect(failedRunStatusForAttempt(4, 3)).toBe("dead");
  });

  test("builds the expired lease requeue patch shape", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    expect(expiredLeaseRequeuePatch(now, "expired")).toEqual({
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      nextAttemptAt: now,
      status: "queued",
      statusReason: "expired",
      updatedAt: now,
      workerId: null,
    });
  });

  test("parses only positive integer input", () => {
    expect(positiveInteger("")).toBeUndefined();
    expect(positiveInteger(null)).toBeUndefined();
    expect(positiveInteger("3")).toBe(3);
    expect(positiveInteger(3.5)).toBeUndefined();
    expect(positiveInteger(-1)).toBeUndefined();
  });
});
