import type {
  EventRecord,
  LoopGraphProjection,
} from "../../../core/index.js";
import {
  projectWorkflowRun,
} from "../workflow-run-projection.js";
import {
  conversationSegmentIdForEvent,
  projectWorkflowRunConversations,
} from "./conversations.js";
import {
  eventDetailNumber,
  eventDetailString,
  eventDurationLabel,
  eventModel,
  eventParentStepId,
  eventProvider,
  eventProviderRefs,
  eventStepId,
  formatClockTime,
  formatDurationLabel,
  formatElapsedLabel,
  isTerminalRunEvent,
  questionIdsFromEvent,
} from "./events.js";
import {
  formatWorkflowRunEvent,
} from "./formatter.js";
import type {
  DeltaBuffer,
  WorkflowRunSemanticRow,
  WorkflowRunStore,
  WorkflowRunStoreSnapshot,
} from "./types.js";

export function createWorkflowRunStore(input: {
  activityLimit?: number;
  batchMs?: number;
  graph: LoopGraphProjection;
  input?: unknown;
  transcriptLimit?: number;
}): WorkflowRunStore {
  const events: EventRecord[] = [];
  const activeConversationSegments = new Map<string, string>();
  const modelDeltaBuffers = new Map<string, DeltaBuffer>();
  const questionStepIds = new Map<string, string>();
  const workerDeltaBuffers = new Map<string, DeltaBuffer>();
  const pending: EventRecord[] = [];
  const transcript: WorkflowRunSemanticRow[] = [];
  const listeners = new Set<(snapshot: WorkflowRunStoreSnapshot) => void>();
  const activityLimit = input.activityLimit ?? 5;
  const transcriptLimit = input.transcriptLimit ?? 80;
  const batchMs = input.batchMs ?? 16;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let lastFlush = Date.now();
  let lastEventAtMs: number | undefined;
  let runEndedAtMs: number | undefined;
  let runStartedAtMs: number | undefined;
  let snapshot = buildSnapshot();

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.length = 0;
      listeners.clear();
    },
    events() {
      return [...events];
    },
    flush,
    push(event) {
      if (closed) return;
      pending.push(event);
      if (batchMs <= 0) {
        flush();
        return;
      }
      const elapsed = Date.now() - lastFlush;
      if (timer) return;
      if (elapsed < batchMs) {
        timer = setTimeout(flush, batchMs - elapsed);
        return;
      }
      flush();
    },
    snapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  function flush() {
    if (closed || pending.length === 0) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    const batch = pending.splice(0);
    for (const event of batch) {
      events.push(event);
      upsertSemanticRow(event);
    }
    lastFlush = Date.now();
    snapshot = buildSnapshot();
    for (const listener of listeners) listener(snapshot);
  }

  function buildSnapshot(): WorkflowRunStoreSnapshot {
    return {
      ...projectWorkflowRun({
        activityLimit,
        events,
        graph: input.graph,
        input: input.input,
      }),
      conversations: projectWorkflowRunConversations(events, transcript),
      runDurationLabel: runDurationLabel(),
      transcript: [...transcript],
    };
  }

  function upsertSemanticRow(event: EventRecord) {
    const item = formatWorkflowRunEvent({
      event,
      modelDeltaBuffers,
      workerDeltaBuffers,
    });
    if (!item) return;
    const stepId = semanticStepId(event);
    const row: WorkflowRunSemanticRow = {
      children: item.children,
      conversationId: conversationSegmentIdForEvent(event, activeConversationSegments),
      durationLabel: eventDurationLabel(event),
      eventIndex: event.index,
      eventType: event.type,
      id: item.id,
      iterationIndex: eventDetailNumber(event, "iterationIndex"),
      iterationLabel: eventDetailString(event, "iterationLabel"),
      iterationTotal: eventDetailNumber(event, "iterationTotal"),
      itemWorkflowStepId: eventDetailString(event, "itemWorkflowStepId"),
      model: eventModel(event),
      operationId: eventDetailString(event, "operationId"),
      parentStepId: eventParentStepId(event),
      phaseId: item.phaseId,
      phaseTitle: item.phaseTitle,
      provider: eventProvider(event),
      providerRefs: eventProviderRefs(event),
      status: item.status,
      stepId,
      text: item.text,
      trace: event.trace,
      ...eventTimeLabels(event),
    };
    const existing = transcript.findIndex((candidate) => candidate.id === row.id);
    if (existing >= 0) {
      transcript[existing] = row;
    } else {
      quietOlderRunningRows();
      transcript.push(row);
    }
    while (transcript.length > transcriptLimit) transcript.shift();
  }

  function semanticStepId(event: EventRecord) {
    const stepId = eventStepId(event);
    if (event.type === "question.requested" && stepId) {
      for (const questionId of questionIdsFromEvent(event)) {
        questionStepIds.set(questionId, stepId);
      }
    }
    if (event.type === "question.answered") {
      const questionId = eventDetailString(event, "questionId");
      if (questionId) return stepId ?? questionStepIds.get(questionId);
    }
    return stepId;
  }

  function quietOlderRunningRows() {
    for (const row of transcript) {
      if (row.status === "running") row.status = "info";
    }
  }

  function eventTimeLabels(event: EventRecord) {
    const timestampMs = Date.parse(event.timestamp);
    if (!Number.isFinite(timestampMs)) return {};
    if (runStartedAtMs === undefined || event.type === "run.started") {
      runStartedAtMs = timestampMs;
      runEndedAtMs = undefined;
    }
    lastEventAtMs = timestampMs;
    if (isTerminalRunEvent(event.type)) runEndedAtMs = timestampMs;
    const clockLabel = formatClockTime(timestampMs);
    const elapsedLabel = formatElapsedLabel(timestampMs - runStartedAtMs);
    return {
      clockLabel,
      elapsedLabel,
      timeLabel: `${clockLabel} ${elapsedLabel}`,
    };
  }

  function runDurationLabel() {
    if (runStartedAtMs === undefined) return undefined;
    const endAtMs = runEndedAtMs ?? lastEventAtMs;
    if (endAtMs === undefined) return undefined;
    return formatDurationLabel(Math.max(0, endAtMs - runStartedAtMs));
  }
}
