import type {
  EventRecord,
} from "../../../core/index.js";
import type {
  WorkflowRunConversationView,
} from "./types.js";

export function isTerminalRunEvent(type: string) {
  return type === "run.cancelled" ||
    type === "run.completed" ||
    type === "run.failed" ||
    type === "run.paused";
}

export function eventDurationLabel(event: EventRecord) {
  const detailDuration = isPlainRecord(event.detail) && typeof event.detail.durationMs === "number"
    ? event.detail.durationMs
    : undefined;
  const duration = detailDuration ?? (typeof event.durationMs === "number" ? event.durationMs : undefined);
  return typeof duration === "number" ? formatDurationLabel(duration) : undefined;
}

export function eventStepId(event: EventRecord) {
  return event.stepId ??
    stringAttribute(event.trace?.attributes?.stepId) ??
    stepIdFromSpanId(event.trace?.parentSpanId) ??
    stepIdFromSpanId(event.trace?.spanId);
}

export function eventParentStepId(event: EventRecord) {
  const parentSpanId = event.trace?.parentSpanId;
  if (typeof parentSpanId !== "string" || !parentSpanId.startsWith("step:")) return undefined;
  const parentStepId = parentSpanId.slice("step:".length).split(":")[0];
  const stepId = eventStepId(event);
  return parentStepId && parentStepId !== stepId ? parentStepId : undefined;
}

export function eventDetailString(event: EventRecord, key: string) {
  return isPlainRecord(event.detail) ? stringAttribute(event.detail[key]) : undefined;
}

export function eventDetailNumber(event: EventRecord, key: string) {
  if (!isPlainRecord(event.detail)) return undefined;
  const value = event.detail[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function questionIdsFromEvent(event: EventRecord) {
  if (!isPlainRecord(event.detail) || !Array.isArray(event.detail.questions)) return [];
  return event.detail.questions.flatMap((question) => {
    if (!isPlainRecord(question)) return [];
    const id = stringAttribute(question.id);
    return id ? [id] : [];
  });
}

export function eventProvider(event: EventRecord) {
  return stringAttribute(event.provider) ??
    eventDetailString(event, "provider") ??
    stringAttribute(event.trace?.attributes?.provider);
}

export function eventModel(event: EventRecord) {
  return eventDetailString(event, "model") ?? stringAttribute(event.trace?.attributes?.model);
}

export function eventOperation(event: EventRecord) {
  return stringAttribute(event.operation) ??
    eventDetailString(event, "operation") ??
    stringAttribute(event.trace?.attributes?.operation) ??
    operationFromTitle(event);
}

export function eventProviderRefs(event: EventRecord) {
  const refs = event.providerRefs;
  if (!isPlainRecord(refs)) return undefined;
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(refs)) {
    if (typeof value === "string") result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

export function eventClockLabel(event: EventRecord) {
  const timestampMs = Date.parse(event.timestamp);
  return Number.isFinite(timestampMs) ? formatClockTime(timestampMs) : undefined;
}

export function eventElapsedLabel(event: EventRecord) {
  if (typeof event.trace?.attributes?.elapsedMs === "number") {
    return formatElapsedLabel(event.trace.attributes.elapsedMs);
  }
  return undefined;
}

export function eventTraceSummary(event: EventRecord): WorkflowRunConversationView["trace"] | undefined {
  if (!event.trace) return undefined;
  return {
    parentSpanId: event.trace.parentSpanId,
    spanId: event.trace.spanId,
    traceId: event.trace.traceId,
  };
}

export function mergeProviderRefs(target: Record<string, string | undefined>, source: Record<string, string | undefined> | undefined) {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (value && !target[key]) target[key] = value;
  }
}

export function workerEventPayload(event: EventRecord) {
  return event as EventRecord & {
    input?: unknown;
    itemId?: unknown;
    itemKind?: unknown;
    output?: unknown;
    preview?: unknown;
    provider?: unknown;
    raw?: unknown;
    rawType?: unknown;
    title?: unknown;
  };
}

export function modelPromptText(value: unknown) {
  if (isPlainRecord(value) && typeof value.message === "string") return value.message;
  if (typeof value === "string") return value;
  return value === undefined ? undefined : jsonPreview(value);
}

export function toolTitle(event: EventRecord) {
  const worker = workerEventPayload(event);
  const title = stringAttribute(worker.title) ?? stringAttribute(worker.preview) ?? event.message;
  const match = title.match(/\b(?:using|completed|failed)\s+([a-zA-Z0-9_.:-]+)\b/);
  return match?.[1] ? `TOOL CALL ${match[1]}` : `TOOL CALL ${title}`;
}

export function rawEventPreview(event: EventRecord) {
  const worker = workerEventPayload(event);
  if (worker.raw !== undefined) return worker.raw;
  if (isPlainRecord(event.detail) && event.detail.raw !== undefined) return event.detail.raw;
  return undefined;
}

export function deltaText(event: EventRecord) {
  const detail = event.detail as {
    content?: unknown;
    delta?: unknown;
    text?: unknown;
  } | undefined;
  for (const value of [detail?.delta, detail?.text, detail?.content, event.text, event.preview]) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function operationChildren(event: EventRecord): string[] {
  const detail = event.detail as { operationId?: unknown; stage?: unknown } | undefined;
  return [
    typeof detail?.operationId === "string" ? `operation: ${detail.operationId}` : undefined,
    typeof detail?.stage === "string" ? `stage: ${detail.stage}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

export function previewText(value: unknown) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

export function jsonPreview(value: unknown) {
  try {
    return previewText(JSON.stringify(value));
  } catch {
    return previewText(String(value));
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringAttribute(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function titleCase(value: string) {
  return value.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function slugId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "conversation";
}

export function formatClockTime(value: number) {
  const date = new Date(value);
  return [
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatElapsedLabel(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "+";
  if (abs < 1000) return `${sign}${Math.round(abs)}ms`;
  if (abs < 10_000) return `${sign}${(abs / 1000).toFixed(2)}s`;
  if (abs < 60_000) return `${sign}${(abs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  return `${sign}${minutes}m${String(seconds).padStart(2, "0")}s`;
}

export function formatDurationLabel(value: number) {
  const abs = Math.abs(value);
  if (abs < 1000) return `${Math.round(abs)}ms`;
  if (abs < 10_000) return `${(abs / 1000).toFixed(2)}s`;
  if (abs < 60_000) return `${(abs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function operationFromTitle(event: EventRecord) {
  const title = stringAttribute(event.title) ?? stringAttribute(event.preview) ?? event.message;
  return title
    .replace(/\s+(started|finished|wrote|completed|failed)\s+.*$/i, "")
    .replace(/\s+output\s*.*$/i, "")
    .trim() || undefined;
}

function stepIdFromSpanId(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("step:")) return undefined;
  const stepId = value.slice("step:".length).split(":")[0];
  return stepId || undefined;
}
