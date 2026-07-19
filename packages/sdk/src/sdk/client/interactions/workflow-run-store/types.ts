import type {
  EventRecord,
} from "../../../core/index.js";
import type {
  TerminalTraceChild,
  TerminalTraceItem,
} from "../terminal-trace-renderer.js";
import type {
  WorkflowRunProjection,
} from "../workflow-run-projection.js";

export type WorkflowRunSemanticRow = {
  children?: TerminalTraceChild[];
  clockLabel?: string;
  conversationId?: string;
  durationLabel?: string;
  elapsedLabel?: string;
  eventIndex?: number;
  eventType?: string;
  id: string;
  iterationIndex?: number;
  iterationLabel?: string;
  iterationTotal?: number;
  itemWorkflowStepId?: string;
  model?: string;
  operationId?: string;
  parentStepId?: string;
  phaseId: string;
  phaseTitle: string;
  provider?: string;
  providerRefs?: Record<string, string | undefined>;
  status: TerminalTraceItem["status"];
  stepId?: string;
  text: string;
  timeLabel?: string;
  trace?: EventRecord["trace"];
};

export type WorkflowRunConversationSection =
  | { kind: "prompt"; text: string; title: "PROMPT" }
  | { chars: number; kind: "assistant"; text: string; title: "ASSISTANT STREAM" }
  | { input?: unknown; kind: "toolCall"; output?: unknown; status: string; title: string }
  | { chars: number; kind: "final"; text: string; title: "FINAL OUTPUT" }
  | { error: string; kind: "error"; title: "ERROR" }
  | { eventType: string; kind: "raw"; preview: unknown; title: "RAW EVENT" };

export type WorkflowRunConversationView = {
  activityRowId?: string;
  clockLabel?: string;
  durationLabel?: string;
  elapsedLabel?: string;
  eventIndexes: number[];
  eventTypes: string[];
  eventsCount: number;
  finalOutput?: string;
  id: string;
  model?: string;
  operation?: string;
  provider?: string;
  providerRefs?: Record<string, string | undefined>;
  rawPreview?: unknown;
  runId: string;
  sections: WorkflowRunConversationSection[];
  status: TerminalTraceItem["status"];
  stepId?: string;
  title: string;
  trace?: {
    parentSpanId?: string;
    spanId?: string;
    traceId?: string;
  };
};

export type WorkflowRunStoreSnapshot = WorkflowRunProjection & {
  conversations: WorkflowRunConversationView[];
  runDurationLabel?: string;
  transcript: WorkflowRunSemanticRow[];
};

export type WorkflowRunStore = {
  close(): void;
  events(): EventRecord[];
  flush(): void;
  push(event: EventRecord): void;
  snapshot(): WorkflowRunStoreSnapshot;
  subscribe(listener: (snapshot: WorkflowRunStoreSnapshot) => void): () => void;
};

export type DeltaBuffer = {
  content: string;
  length: number;
};
