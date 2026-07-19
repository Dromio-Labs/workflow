import type {
  EventRecord,
} from "../../../core/index.js";
import {
  defaultFormatEvent,
  type TerminalTraceItem,
} from "../terminal-trace-renderer.js";
import {
  deltaText,
  isPlainRecord,
  jsonPreview,
  operationChildren,
  previewText,
  stringAttribute,
  titleCase,
} from "./events.js";
import type {
  DeltaBuffer,
} from "./types.js";

const MAX_DELTA_BUFFER_CHARS = 12_000;
const IMPORTANT_PAYLOAD_KEYS = [
  "command",
  "cmd",
  "args",
  "path",
  "filePath",
  "file",
  "pattern",
  "query",
  "stdout",
  "stderr",
  "output",
  "result",
  "error",
  "diff",
  "patch",
  "content",
  "text",
  "message",
];

export function formatWorkflowRunEvent(input: {
  event: EventRecord;
  modelDeltaBuffers: Map<string, DeltaBuffer>;
  workerDeltaBuffers: Map<string, DeltaBuffer>;
}): TerminalTraceItem | undefined {
  if (input.event.type === "model.response.delta") {
    return formatDeltaEvent(input.event, input.modelDeltaBuffers, "model", "Model");
  }
  if (input.event.type === "worker.item.delta") {
    return formatDeltaEvent(input.event, input.workerDeltaBuffers, "worker", "Worker");
  }
  if (input.event.type.startsWith("worker.item.")) {
    return formatWorkerItemEvent(input.event);
  }
  if (input.event.type === "operation.progress") {
    return {
      children: operationChildren(input.event),
      id: input.event.trace?.spanId ? `${input.event.trace.spanId}.progress` : `operation.progress.${input.event.index}`,
      phaseId: stringAttribute(input.event.trace?.attributes?.phase) ?? "operations",
      phaseTitle: titleCase(stringAttribute(input.event.trace?.attributes?.phase) ?? "operations"),
      status: "running",
      text: input.event.message,
    };
  }
  return defaultFormatEvent(input.event);
}

function formatWorkerItemEvent(event: EventRecord): TerminalTraceItem | undefined {
  const item = event as {
    error?: unknown;
    input?: unknown;
    itemId?: unknown;
    itemKind?: unknown;
    output?: unknown;
    preview?: unknown;
    provider?: unknown;
    rawType?: unknown;
    text?: unknown;
    title?: unknown;
  };
  const title = stringAttribute(item.title) ?? stringAttribute(item.preview) ?? event.message;
  const phaseId = stringAttribute(event.trace?.attributes?.phase) ?? "worker";
  return {
    children: workerItemChildren(item),
    id: `worker.${stringAttribute(item.itemId) ?? event.index}`,
    phaseId,
    phaseTitle: titleCase(phaseId),
    status: event.type === "worker.item.failed" ? "error" : event.type === "worker.item.completed" ? "ok" : "running",
    text: title,
  };
}

function workerItemChildren(item: {
  error?: unknown;
  input?: unknown;
  itemKind?: unknown;
  output?: unknown;
  provider?: unknown;
  rawType?: unknown;
}) {
  return [
    ...(stringAttribute(item.provider) ? [`provider: ${item.provider}`] : []),
    ...(stringAttribute(item.rawType) ? [`event: ${item.rawType}`] : []),
    ...(stringAttribute(item.error) ? [`error: ${previewText(item.error)}`] : []),
    ...payloadChildren("input", item.input, stringAttribute(item.itemKind)),
    ...payloadChildren("output", item.output, stringAttribute(item.itemKind)),
  ];
}

function payloadChildren(label: "input" | "output", value: unknown, itemKind: string | undefined): string[] {
  if (value === undefined) return [];
  if (itemKind === "model_step" && label === "input") return [];
  return summarizePayload(value).slice(0, 4).map((line) => `${label}.${line}`);
}

function formatDeltaEvent(
  event: EventRecord,
  buffers: Map<string, DeltaBuffer>,
  fallbackPhaseId: string,
  fallbackPhaseTitle: string,
): TerminalTraceItem | undefined {
  const delta = deltaText(event);
  if (!delta) return undefined;
  const id = event.trace?.spanId ?? `${fallbackPhaseId}.${event.stepId ?? "output"}`;
  const previous = buffers.get(id) ?? { content: "", length: 0 };
  const nextContent = `${previous.content}${delta}`;
  const content = nextContent.length > MAX_DELTA_BUFFER_CHARS
    ? nextContent.slice(-MAX_DELTA_BUFFER_CHARS)
    : nextContent;
  const length = previous.length + delta.length;
  buffers.set(id, { content, length });
  const phaseId = stringAttribute(event.trace?.attributes?.phase) ?? fallbackPhaseId;
  const operation = stringAttribute((event.detail as { operation?: unknown } | undefined)?.operation) ??
    stringAttribute(event.trace?.attributes?.operation) ??
    event.trace?.name ??
    `${fallbackPhaseTitle.toLowerCase()} output`;
  const label = operation.toLowerCase().endsWith("output") ? operation : `${operation} output`;
  return {
    children: previewLines(content),
    id: `${id}.output`,
    phaseId,
    phaseTitle: titleCase(phaseId),
    status: "running",
    text: `${label} (${length} chars)`,
  };
}

function summarizePayload(value: unknown): string[] {
  if (typeof value === "string") return [previewText(value)];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      return [previewText(value.map(String).join(" "))];
    }
    return [jsonPreview(value)];
  }
  if (!isPlainRecord(value)) return [];
  if (value.truncated === true && typeof value.preview === "string") return [previewText(value.preview)];

  const lines: string[] = [];
  collectImportantPayloadLines(value, "", lines);
  if (lines.length > 0) return lines;
  return [jsonPreview(value)];
}

function collectImportantPayloadLines(
  value: Record<string, unknown>,
  prefix: string,
  lines: string[],
  depth = 0,
) {
  if (depth > 2 || lines.length >= 6) return;
  for (const key of IMPORTANT_PAYLOAD_KEYS) {
    if (!(key in value)) continue;
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    pushPayloadLine(nextPrefix, value[key], lines, depth);
    if (lines.length >= 6) return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (IMPORTANT_PAYLOAD_KEYS.includes(key)) continue;
    if (!isPlainRecord(child)) continue;
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    collectImportantPayloadLines(child, nextPrefix, lines, depth + 1);
    if (lines.length >= 6) return;
  }
}

function pushPayloadLine(
  key: string,
  value: unknown,
  lines: string[],
  depth: number,
) {
  if (value === undefined || value === null) return;
  if (typeof value === "string") {
    if (value.trim()) lines.push(`${key}: ${previewText(value)}`);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    lines.push(`${key}: ${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return;
    if (value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      lines.push(`${key}: ${previewText(value.map(String).join(" "))}`);
      return;
    }
    lines.push(`${key}: ${jsonPreview(value)}`);
    return;
  }
  if (!isPlainRecord(value)) return;
  if (value.truncated === true && typeof value.preview === "string") {
    lines.push(`${key}: ${previewText(value.preview)}`);
    return;
  }
  collectImportantPayloadLines(value, key, lines, depth + 1);
}

function previewLines(value: string) {
  const lines = value.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const safeLines = lines.length > 0 ? lines : [value.trim()].filter(Boolean);
  const visible = safeLines.length > 5
    ? [`... ${safeLines.length - 5} earlier lines`, ...safeLines.slice(-5)]
    : safeLines;
  return visible.map(previewText);
}
