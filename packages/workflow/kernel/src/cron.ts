import { CronExpressionParser } from "cron-parser";

const CRON_FIELD_SPLITTER = /\s+/;
const INTERVAL_PATTERN = /^\*\/(\d+)$/;
const RANGE_PATTERN = /^(\d+)-(\d+)$/;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type SimpleFrequency =
  | "every-minute"
  | "every-n-minutes"
  | "hourly"
  | "daily"
  | "weekly";

export type SimpleSchedule = {
  frequency: SimpleFrequency;
  interval?: number;
  minute?: number;
  hour?: number;
  daysOfWeek?: number[];
};

export function validateCronExpression(cronExpression: string): {
  valid: boolean;
  error?: string;
} {
  if (!cronExpression || typeof cronExpression !== "string") {
    return { valid: false, error: "Cron expression is required" };
  }

  const parts = cronExpression.trim().split(CRON_FIELD_SPLITTER);
  if (parts.length < 5 || parts.length > 6) {
    return {
      valid: false,
      error: "Cron expression must have 5 or 6 fields",
    };
  }

  try {
    CronExpressionParser.parse(cronExpression);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid cron expression",
    };
  }
}

export function buildCronFromSimple(state: SimpleSchedule): string {
  switch (state.frequency) {
    case "every-minute":
      return "* * * * *";
    case "every-n-minutes":
      return `*/${state.interval ?? 5} * * * *`;
    case "hourly":
      return `${state.minute ?? 0} * * * *`;
    case "daily":
      return `${state.minute ?? 0} ${state.hour ?? 9} * * *`;
    case "weekly": {
      const days =
        state.daysOfWeek !== undefined && state.daysOfWeek.length > 0
          ? state.daysOfWeek.join(",")
          : "*";
      return `${state.minute ?? 0} ${state.hour ?? 9} * * ${days}`;
    }
    default:
      return "* * * * *";
  }
}

function parseNumericField(field: string): number | null {
  const num = Number.parseInt(field, 10);
  if (Number.isNaN(num) || String(num) !== field) {
    return null;
  }
  return num;
}

function parseWildcardMinute(
  minuteField: string,
  hourField: string,
  dayOfWeek: string
): SimpleSchedule | null {
  if (minuteField === "*" && hourField === "*" && dayOfWeek === "*") {
    return { frequency: "every-minute" };
  }

  const intervalMatch = minuteField.match(INTERVAL_PATTERN);
  if (intervalMatch !== null && hourField === "*" && dayOfWeek === "*") {
    return {
      frequency: "every-n-minutes",
      interval: Number.parseInt(intervalMatch[1], 10),
    };
  }

  return null;
}

export function parseCronToSimple(cron: string): SimpleSchedule | null {
  if (!cron) {
    return null;
  }

  const parts = cron.trim().split(CRON_FIELD_SPLITTER);
  if (parts.length !== 5) {
    return null;
  }

  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = parts;

  if (dayOfMonth !== "*" || month !== "*") {
    return null;
  }

  const wildcardResult = parseWildcardMinute(minuteField, hourField, dayOfWeek);
  if (wildcardResult !== null) {
    return wildcardResult;
  }

  const minuteNum = parseNumericField(minuteField);
  if (minuteNum === null) {
    return null;
  }

  if (hourField === "*" && dayOfWeek === "*") {
    return { frequency: "hourly", minute: minuteNum };
  }

  const hourNum = parseNumericField(hourField);
  if (hourNum === null) {
    return null;
  }

  if (dayOfWeek === "*") {
    return { frequency: "daily", minute: minuteNum, hour: hourNum };
  }

  const days = parseDaysOfWeek(dayOfWeek);
  if (days === null) {
    return null;
  }

  return {
    frequency: "weekly",
    minute: minuteNum,
    hour: hourNum,
    daysOfWeek: days,
  };
}

function parseDayToken(token: string): number[] | null {
  const rangeMatch = token.match(RANGE_PATTERN);
  if (rangeMatch === null) {
    const num = parseNumericField(token);
    if (num === null || num > 6) {
      return null;
    }
    return [num];
  }

  const start = Number.parseInt(rangeMatch[1], 10);
  const end = Number.parseInt(rangeMatch[2], 10);
  if (start > 6 || end > 6 || start > end) {
    return null;
  }

  const result: number[] = [];
  for (let i = start; i <= end; i++) {
    result.push(i);
  }
  return result;
}

function parseDaysOfWeek(field: string): number[] | null {
  const days: number[] = [];

  for (const part of field.split(",")) {
    const parsed = parseDayToken(part);
    if (parsed === null) {
      return null;
    }
    days.push(...parsed);
  }

  return days.length > 0 ? days : null;
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  let displayHour = hour;
  if (hour === 0) {
    displayHour = 12;
  } else if (hour > 12) {
    displayHour = hour - 12;
  }
  const displayMinute = String(minute).padStart(2, "0");
  return `${displayHour}:${displayMinute} ${period}`;
}

export function describeCron(cron: string): string {
  if (!cron) {
    return "";
  }

  const simple = parseCronToSimple(cron);
  if (simple !== null) {
    return describeSimple(simple);
  }

  const validation = validateCronExpression(cron);
  if (!validation.valid) {
    return "";
  }

  return "Custom schedule";
}

function describeSimple(s: SimpleSchedule): string {
  switch (s.frequency) {
    case "every-minute":
      return "Every minute";
    case "every-n-minutes":
      return `Every ${s.interval} minutes`;
    case "hourly":
      return s.minute === 0
        ? "Every hour on the hour"
        : `Every hour at minute ${s.minute}`;
    case "daily":
      return `Every day at ${formatTime(s.hour ?? 9, s.minute ?? 0)}`;
    case "weekly": {
      const days = s.daysOfWeek ?? [];
      const time = formatTime(s.hour ?? 9, s.minute ?? 0);

      if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
        return `Every weekday at ${time}`;
      }

      if (days.length === 1) {
        return `Every ${DAY_NAMES[days[0]]} at ${time}`;
      }

      const dayNames = days.map((d) => DAY_NAMES[d]).join(", ");
      return `Every ${dayNames} at ${time}`;
    }
    default:
      return "Custom schedule";
  }
}

export function computeNextRunTime(
  cronExpression: string,
  timezone: string,
  currentDate: Date = new Date()
): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate,
      tz: timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export function validateTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
