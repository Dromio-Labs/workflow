import type {
  EventRecord,
} from "../../../core/index.js";
import {
  deltaText,
  eventClockLabel,
  eventDurationLabel,
  eventElapsedLabel,
  eventModel,
  eventOperation,
  eventProvider,
  eventProviderRefs,
  eventStepId,
  eventTraceSummary,
  isPlainRecord,
  mergeProviderRefs,
  modelPromptText,
  rawEventPreview,
  slugId,
  stringAttribute,
  toolTitle,
  workerEventPayload,
} from "./events.js";
import type {
  WorkflowRunConversationSection,
  WorkflowRunConversationView,
  WorkflowRunSemanticRow,
} from "./types.js";

export function projectWorkflowRunConversations(
  events: EventRecord[],
  transcript: WorkflowRunSemanticRow[],
): WorkflowRunConversationView[] {
  const activeConversationSegments = new Map<string, string>();
  const conversationIdsByEventIndex = new Map<number, string>();
  for (const event of events) {
    const id = conversationSegmentIdForEvent(event, activeConversationSegments);
    if (id) conversationIdsByEventIndex.set(event.index, id);
  }
  const rowsByConversationId = new Map(
    transcript
      .filter((row) => row.conversationId)
      .map((row) => [row.conversationId!, row]),
  );
  const conversations = new Map<string, ConversationAccumulator>();
  for (const event of events) {
    const id = conversationIdsByEventIndex.get(event.index);
    if (!id) continue;
    const conversation = conversations.get(id) ?? createConversationAccumulator(id, event);
    conversations.set(id, conversation);
    conversation.eventIndexes.push(event.index);
    conversation.eventTypes.add(event.type);
    conversation.status = conversationStatus(conversation.status, event);
    conversation.stepId ??= eventStepId(event);
    conversation.provider ??= eventProvider(event);
    conversation.model ??= eventModel(event);
    conversation.operation ??= eventOperation(event);
    conversation.durationLabel ??= eventDurationLabel(event);
    conversation.clockLabel ??= eventClockLabel(event);
    conversation.elapsedLabel ??= eventElapsedLabel(event);
    conversation.trace ??= eventTraceSummary(event);
    mergeProviderRefs(conversation.providerRefs, eventProviderRefs(event));
    applyConversationEvent(conversation, event);
  }
  return [...conversations.values()].map((conversation) => {
    const row = rowsByConversationId.get(conversation.id);
    const sections = conversationSections(conversation);
    return {
      activityRowId: row?.id,
      clockLabel: conversation.clockLabel,
      durationLabel: conversation.durationLabel,
      elapsedLabel: conversation.elapsedLabel,
      eventIndexes: conversation.eventIndexes,
      eventTypes: [...conversation.eventTypes],
      eventsCount: conversation.eventIndexes.length,
      finalOutput: conversation.finalText || undefined,
      id: conversation.id,
      model: conversation.model,
      operation: conversation.operation,
      provider: conversation.provider,
      providerRefs: Object.keys(conversation.providerRefs).length ? conversation.providerRefs : undefined,
      rawPreview: conversation.rawPreview,
      runId: conversation.runId,
      sections,
      status: row?.status ?? conversation.status,
      stepId: conversation.stepId,
      title: conversationTitle(conversation),
      trace: conversation.trace,
    };
  });
}

export function conversationSegmentIdForEvent(
  event: EventRecord,
  activeSegments: Map<string, string>,
) {
  if (!isConversationEvent(event)) return undefined;
  const streamKey = conversationStreamKeyForEvent(event);
  if (!streamKey) return `conversation:event:${event.index}`;
  let id = activeSegments.get(streamKey);
  if (!id) {
    id = `conversation:${streamKey}:${event.index}`;
    activeSegments.set(streamKey, id);
  }
  if (conversationEndsSegment(event)) activeSegments.delete(streamKey);
  return id;
}

type ConversationAccumulator = {
  assistantText: string;
  clockLabel?: string;
  durationLabel?: string;
  elapsedLabel?: string;
  error?: string;
  eventIndexes: number[];
  eventTypes: Set<string>;
  finalText: string;
  id: string;
  model?: string;
  operation?: string;
  prompt?: string;
  provider?: string;
  providerRefs: Record<string, string | undefined>;
  rawEventType?: string;
  rawPreview?: unknown;
  runId: string;
  status: WorkflowRunConversationView["status"];
  stepId?: string;
  tools: Map<string, {
    input?: unknown;
    output?: unknown;
    status: string;
    title: string;
  }>;
  trace?: WorkflowRunConversationView["trace"];
};

function createConversationAccumulator(id: string, event: EventRecord): ConversationAccumulator {
  return {
    assistantText: "",
    eventIndexes: [],
    eventTypes: new Set(),
    finalText: "",
    id,
    providerRefs: {},
    runId: event.runId,
    status: "running",
    tools: new Map(),
  };
}

function applyConversationEvent(conversation: ConversationAccumulator, event: EventRecord) {
  const worker = workerEventPayload(event);
  if (event.type === "worker.item.started" && worker.itemKind === "model_step") {
    conversation.prompt ??= modelPromptText(worker.input);
  }
  if (event.type === "worker.item.delta") {
    conversation.assistantText += deltaText(event) ?? "";
  }
  if (event.type.startsWith("worker.item.") && worker.itemKind === "tool_call") {
    const itemId = stringAttribute(worker.itemId) ?? `tool:${event.index}`;
    const tool = conversation.tools.get(itemId) ?? {
      status: "running",
      title: toolTitle(event),
    };
    tool.title = toolTitle(event);
    tool.status = event.type === "worker.item.failed"
      ? "failed"
      : event.type === "worker.item.completed"
      ? "completed"
      : "running";
    if (worker.input !== undefined) tool.input = worker.input;
    if (worker.output !== undefined) tool.output = worker.output;
    conversation.tools.set(itemId, tool);
  }
  if (event.type === "model.response.delta") {
    conversation.finalText += deltaText(event) ?? "";
  }
  if (event.type === "worker.item.failed" || event.type === "model.request.failed") {
    conversation.error = stringAttribute(event.error) ??
      (isPlainRecord(event.detail) ? stringAttribute(event.detail.error) : undefined) ??
      event.message;
  }
  const rawPreview = rawEventPreview(event);
  if (rawPreview !== undefined) {
    conversation.rawPreview = rawPreview;
    conversation.rawEventType = stringAttribute(event.rawType) ?? event.type;
  }
}

function conversationSections(conversation: ConversationAccumulator): WorkflowRunConversationSection[] {
  return [
    ...(conversation.prompt ? [{
      kind: "prompt" as const,
      text: conversation.prompt,
      title: "PROMPT" as const,
    }] : []),
    ...(conversation.assistantText ? [{
      chars: conversation.assistantText.length,
      kind: "assistant" as const,
      text: conversation.assistantText,
      title: "ASSISTANT STREAM" as const,
    }] : []),
    ...[...conversation.tools.values()].map((tool) => ({
      input: tool.input,
      kind: "toolCall" as const,
      output: tool.output,
      status: tool.status,
      title: tool.title,
    })),
    ...(conversation.finalText ? [{
      chars: conversation.finalText.length,
      kind: "final" as const,
      text: conversation.finalText,
      title: "FINAL OUTPUT" as const,
    }] : []),
    ...(conversation.error ? [{
      error: conversation.error,
      kind: "error" as const,
      title: "ERROR" as const,
    }] : []),
    ...(conversation.rawPreview !== undefined ? [{
      eventType: conversation.rawEventType ?? "raw",
      kind: "raw" as const,
      preview: conversation.rawPreview,
      title: "RAW EVENT" as const,
    }] : []),
  ];
}

function conversationTitle(conversation: ConversationAccumulator) {
  const subject = conversation.operation ?? "Model conversation";
  return conversation.provider ? `${subject} · ${conversation.provider}` : subject;
}

function conversationStatus(
  current: WorkflowRunConversationView["status"],
  event: EventRecord,
): WorkflowRunConversationView["status"] {
  if (event.type.endsWith(".failed")) return "error";
  if (current === "error") return current;
  if (event.type === "model.response.completed" || event.type === "worker.item.completed") return "ok";
  return current;
}

function conversationStreamKeyForEvent(event: EventRecord) {
  const provider = eventProvider(event);
  const stepId = eventStepId(event);
  const operation = eventOperation(event);
  if (provider && stepId && operation) return `${provider}:${stepId}:${slugId(operation)}`;
  const refs = eventProviderRefs(event);
  if (refs?.sessionId && refs.messageId) return `${provider ?? "provider"}:${refs.sessionId}:${refs.messageId}`;
  if (refs?.sessionId) return `${provider ?? "provider"}:${refs.sessionId}`;
  if (event.trace?.spanId) return `trace:${event.trace.spanId}`;
  return undefined;
}

function conversationEndsSegment(event: EventRecord) {
  const worker = workerEventPayload(event);
  return event.type === "model.response.completed" ||
    event.type === "model.request.failed" ||
    (event.type === "worker.item.completed" && worker.itemKind === "model_step") ||
    (event.type === "worker.item.failed" && worker.itemKind === "model_step");
}

function isConversationEvent(event: EventRecord) {
  return event.type === "model.request.started" ||
    event.type === "model.request.failed" ||
    event.type === "model.response.delta" ||
    event.type === "model.response.completed" ||
    event.type === "worker.item.started" ||
    event.type === "worker.item.delta" ||
    event.type === "worker.item.completed" ||
    event.type === "worker.item.failed";
}
