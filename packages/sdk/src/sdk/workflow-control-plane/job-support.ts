import { createHash } from "node:crypto";
import type {
  WorkflowAppRunOrigin,
  WorkflowAppRunSnapshot,
} from "../client/interactions/workflow-app.js";
import type {
  TriggerDescriptor,
  TriggerJobSnapshot,
  WorkflowControlPlane,
} from "./types.js";

export function stableTriggerPayloadHash(value: unknown): string {
  return stableHash(stripVolatileTriggerPayloadFields(value));
}

export function workflowInputFromJob(job: TriggerJobSnapshot): string {
  const payload = job.payload;
  if (!("input" in payload)) {
    throw new Error(`Trigger job ${job.id} does not carry workflow input.`);
  }
  return typeof payload.input === "string"
    ? payload.input
    : JSON.stringify(payload.input, null, 2);
}

export function triggerOriginType(
  trigger: TriggerDescriptor,
): WorkflowAppRunOrigin["type"] {
  if (trigger.type === "webhook") return "http";
  if (trigger.type === "manual") return "manual";
  if (trigger.type === "schedule") return "schedule";
  if (trigger.type === "event") return "event";
  if (trigger.type === "block") return "block";
  return "http";
}

export function matchesRunFilter(
  run: WorkflowAppRunSnapshot,
  filter: Parameters<WorkflowControlPlane["listRuns"]>[0],
) {
  if (!filter) return true;
  if (filter.workflowId && run.workflowId !== filter.workflowId) return false;
  if (filter.originType && run.origin?.type !== filter.originType) return false;
  return true;
}

export function lastRunTimestamp(run: WorkflowAppRunSnapshot) {
  return run.events.at(-1)?.timestamp ?? "";
}

export function isTerminalRunStatus(status: string) {
  return status === "cancelled" || status === "completed" || status === "failed";
}

export function isTerminalJobStatus(status: TriggerJobSnapshot["status"]) {
  return status === "completed" || status === "dead" || status === "failed";
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stripVolatileTriggerPayloadFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!record.http || typeof record.http !== "object" || Array.isArray(record.http)) return value;
  const http = record.http as Record<string, unknown>;
  const stableHttp: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(http)) {
    if (key !== "receivedAt") stableHttp[key] = item;
  }
  return {
    ...record,
    http: stableHttp,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
