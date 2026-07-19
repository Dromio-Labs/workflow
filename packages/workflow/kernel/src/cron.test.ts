import { describe, expect, test } from "bun:test";
import {
  buildCronFromSimple,
  computeNextRunTime,
  describeCron,
  parseCronToSimple,
  validateCronExpression,
  validateTimezone,
  type SimpleSchedule,
} from "./cron";

describe("cron kernel", () => {
  test("validates 5-field and 6-field cron expressions and rejects garbage", () => {
    expect(validateCronExpression("0 9 * * *")).toEqual({ valid: true });
    expect(validateCronExpression("0 0 9 * * *")).toEqual({ valid: true });
    expect(validateCronExpression("garbage").valid).toBe(false);
    expect(validateCronExpression("* * * *").error).toBe(
      "Cron expression must have 5 or 6 fields"
    );
  });

  test("round-trips simple schedules through cron strings", () => {
    const schedules: SimpleSchedule[] = [
      { frequency: "every-minute" },
      { frequency: "every-n-minutes", interval: 15 },
      { frequency: "hourly", minute: 20 },
      { frequency: "daily", hour: 9, minute: 0 },
      { frequency: "weekly", daysOfWeek: [1, 2, 3, 4, 5], hour: 9, minute: 0 },
    ];

    for (const schedule of schedules) {
      expect(parseCronToSimple(buildCronFromSimple(schedule))).toEqual(
        schedule
      );
    }
  });

  test("describes daily and weekday schedules", () => {
    expect(describeCron("0 9 * * *")).toBe("Every day at 9:00 AM");
    expect(describeCron("0 9 * * 1-5")).toBe("Every weekday at 9:00 AM");
  });

  test("computes the next occurrence in the requested timezone", () => {
    const currentDate = new Date("2026-01-01T13:30:00.000Z");
    const nextRun = computeNextRunTime(
      "0 9 * * *",
      "America/New_York",
      currentDate
    );

    expect(nextRun?.toISOString()).toBe("2026-01-01T14:00:00.000Z");
  });

  test("computes the next occurrence strictly in the future", () => {
    const currentDate = new Date("2026-01-01T13:30:00.000Z");
    const nextRun = computeNextRunTime("* * * * *", "UTC", currentDate);

    expect(nextRun).not.toBeNull();
    expect(nextRun!.getTime()).toBeGreaterThan(currentDate.getTime());
  });

  test("validates timezone identifiers", () => {
    expect(validateTimezone("UTC")).toBe(true);
    expect(validateTimezone("America/New_York")).toBe(true);
    expect(validateTimezone("Not/AZone")).toBe(false);
  });
});
