import type {
  EventRecord,
  TraceAttributeValue,
  TraceContext,
} from "../../core/index.js";
import type {
  WorkflowRunEvent,
  WorkflowViewSnapshot,
} from "@dromio/workflow-room-protocol";
import {
  projectWorkflowFieldVisualState,
  type WorkflowFieldVisualState,
} from "../workflow-field-svg/index.js";
import type {
  WorkflowRenderModel,
  WorkflowRenderStatus,
} from "../workflow-render/index.js";
import {
  projectTraceTree,
  type TraceTreeSnapshot,
} from "./trace-tree.js";

export type WorkflowPlaybackEvent = {
  event: WorkflowRunEvent;
  id: string;
  offsetMs: number;
  ordinal: number;
  timestampMs?: number;
};

export type WorkflowPlaybackProjection = {
  currentEvent?: WorkflowPlaybackEvent;
  durationMs: number;
  elapsedMs: number;
  endTimestamp?: string;
  events: readonly WorkflowPlaybackEvent[];
  positionMs: number;
  progress: number;
  render: WorkflowRenderModel;
  startTimestamp?: string;
  timed: boolean;
  trace: TraceTreeSnapshot;
  visibleEvents: readonly WorkflowPlaybackEvent[];
  visualState: WorkflowFieldVisualState;
};

export type ProjectWorkflowPlaybackInput = {
  positionMs?: number;
  snapshot: WorkflowViewSnapshot;
};

export function projectWorkflowPlayback(
  input: ProjectWorkflowPlaybackInput,
): WorkflowPlaybackProjection {
  const run = input.snapshot.run;
  const ordered = orderedEvents(run?.events ?? []);
  const timed = ordered.some((item) => item.timestampMs !== undefined);
  const startMs = timed
    ? ordered.find((item) => item.timestampMs !== undefined)?.timestampMs
    : undefined;
  const endMs = startMs === undefined
    ? undefined
    : Math.max(startMs, ...ordered.flatMap((item) =>
      item.timestampMs === undefined ? [] : [item.timestampMs]
    ));
  const durationMs = startMs === undefined || endMs === undefined ? 0 : endMs - startMs;
  const events = ordered.map((item) => ({
    ...item,
    offsetMs: startMs === undefined || item.timestampMs === undefined
      ? 0
      : Math.max(0, item.timestampMs - startMs),
  }));
  const requestedPosition = input.positionMs ?? durationMs;
  const positionMs = Math.max(0, Math.min(durationMs, requestedPosition));
  const visibleEvents = timed
    ? events.filter((item) => item.offsetMs <= positionMs)
    : events;
  const status = playbackStatus(run?.status ?? "idle", visibleEvents, positionMs >= durationMs);
  const visualState = projectWorkflowFieldVisualState(input.snapshot.render, run
    ? {
        events: visibleEvents.map((item) => item.event),
        status,
      }
    : undefined);
  const render = renderWithStatuses(input.snapshot.render, visualState.statuses);
  return {
    ...(visibleEvents.at(-1) ? { currentEvent: visibleEvents.at(-1) } : {}),
    durationMs,
    elapsedMs: positionMs,
    ...(endMs === undefined ? {} : { endTimestamp: new Date(endMs).toISOString() }),
    events,
    positionMs,
    progress: durationMs > 0 ? positionMs / durationMs : events.length ? 1 : 0,
    render,
    ...(startMs === undefined ? {} : { startTimestamp: new Date(startMs).toISOString() }),
    timed,
    trace: projectTraceTree(visibleEvents.map(toEventRecord)),
    visibleEvents,
    visualState,
  };
}

function orderedEvents(events: readonly WorkflowRunEvent[]): WorkflowPlaybackEvent[] {
  return events
    .map((event, ordinal) => ({
      event,
      id: event.id ?? `${event.runId}:${event.index ?? ordinal}`,
      offsetMs: 0,
      ordinal,
      ...(timestampMs(event.timestamp) === undefined
        ? {}
        : { timestampMs: timestampMs(event.timestamp) }),
    }))
    .sort((left, right) => {
      const leftIndex = left.event.index ?? left.ordinal;
      const rightIndex = right.event.index ?? right.ordinal;
      return leftIndex - rightIndex || left.ordinal - right.ordinal;
    });
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function playbackStatus(
  sourceStatus: string,
  events: readonly WorkflowPlaybackEvent[],
  atEnd: boolean,
): string {
  if (atEnd) return sourceStatus;
  for (const item of [...events].reverse()) {
    if (item.event.type === "run.failed") return "failed";
    if (item.event.type === "run.cancelled") return "cancelled";
    if (item.event.type === "run.completed") return "completed";
    if (item.event.type === "question.answered" || item.event.type === "hook.resumed") return "running";
    if (item.event.type === "question.requested" || item.event.type === "hook.waiting") return "waiting";
  }
  return events.length ? "running" : "idle";
}

function renderWithStatuses(
  model: WorkflowRenderModel,
  statuses: Readonly<Record<string, WorkflowRenderStatus>>,
): WorkflowRenderModel {
  return {
    ...model,
    nodes: model.nodes.map((node) => ({
      ...node,
      ...(node.childWorkflow
        ? {
            childWorkflow: {
              ...node.childWorkflow,
              model: renderWithStatuses(node.childWorkflow.model, statuses),
            },
          }
        : {}),
      status: statuses[node.id] ?? node.status,
    })),
  };
}

function toEventRecord(item: WorkflowPlaybackEvent): EventRecord {
  const trace = traceContext(item.event.trace);
  return {
    correlationId: item.id,
    ...(item.event.detail === undefined ? {} : { detail: item.event.detail }),
    index: item.event.index ?? item.ordinal,
    message: item.event.message ?? item.event.type,
    runId: item.event.runId,
    ...(item.event.stepId ? { stepId: item.event.stepId } : {}),
    timestamp: item.event.timestamp ?? new Date(item.offsetMs).toISOString(),
    ...(trace ? { trace } : {}),
    type: item.event.type,
  };
}

function traceContext(value: WorkflowRunEvent["trace"]): TraceContext | undefined {
  if (!value) return undefined;
  const name = stringValue(value.name);
  const spanId = stringValue(value.spanId);
  const traceId = stringValue(value.traceId);
  if (!name || !spanId || !traceId) return undefined;
  const attributes = traceAttributes(value.attributes);
  const kind = value.kind === "internal" || value.kind === "producer" ||
      value.kind === "consumer" || value.kind === "client"
    ? value.kind
    : undefined;
  const status = value.status === "unset" || value.status === "ok" || value.status === "error"
    ? value.status
    : undefined;
  return {
    ...(attributes ? { attributes } : {}),
    ...(kind ? { kind } : {}),
    name,
    ...(stringValue(value.parentSpanId) ? { parentSpanId: stringValue(value.parentSpanId) } : {}),
    spanId,
    ...(status ? { status } : {}),
    traceId,
  };
}

function traceAttributes(value: unknown): Record<string, TraceAttributeValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const attributes = Object.entries(value).flatMap(([key, item]) =>
    traceAttribute(item) === undefined ? [] : [[key, traceAttribute(item)!] as const]
  );
  return attributes.length ? Object.fromEntries(attributes) : undefined;
}

function traceAttribute(value: unknown): TraceAttributeValue | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is boolean | number | string =>
    typeof item === "string" || typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
  );
  return items.length === value.length ? items : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
