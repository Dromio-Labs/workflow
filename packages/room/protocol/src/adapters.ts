import type { WorkflowViewCommand } from "./commands.js";
import type { JsonObject, JsonValue } from "./json.js";
import type {
  WorkflowRoomDecision,
  WorkflowRoomEvent,
  WorkflowRoomMessage,
  WorkflowRoomSnapshot,
} from "./room.js";
import type { WorkflowViewSnapshot } from "./snapshot.js";

export type WorkflowRoomAppendMessageInput = {
  content: string;
  metadata?: JsonObject;
  participantId?: string;
  role?: WorkflowRoomMessage["role"];
  roomId: string;
  visibility?: WorkflowRoomMessage["visibility"];
};

export type WorkflowRoomRecordDecisionInput = {
  content: JsonValue;
  messageId?: string;
  roomId: string;
  title: string;
};

export type WorkflowRoomAppendEventInput = {
  actorParticipantId?: string;
  createdAt?: string;
  kind: string;
  payload: JsonObject;
  roomId: string;
};

export type WorkflowRoomLinkRunInput = {
  executionId?: string;
  metadata?: JsonObject;
  roomId: string;
  runId?: string;
  status: string;
  workflowId: string;
};

export type WorkflowRoomResolveHandRaiseInput = {
  handRaiseId: string;
  resolvedByMessageId?: string;
  roomId: string;
  status?: "dismissed" | "resolved";
};

export type WorkflowRoomAdapter = {
  appendEvent?(input: WorkflowRoomAppendEventInput): Promise<WorkflowRoomSnapshot> | WorkflowRoomSnapshot;
  appendMessage(input: WorkflowRoomAppendMessageInput): Promise<WorkflowRoomSnapshot> | WorkflowRoomSnapshot;
  getSnapshot(roomId: string): Promise<WorkflowRoomSnapshot> | WorkflowRoomSnapshot;
  linkWorkflowRun?(input: WorkflowRoomLinkRunInput): Promise<WorkflowRoomSnapshot> | WorkflowRoomSnapshot;
  recordDecision(input: WorkflowRoomRecordDecisionInput): Promise<WorkflowRoomSnapshot> | WorkflowRoomSnapshot;
  resolveHandRaise(input: WorkflowRoomResolveHandRaiseInput): Promise<WorkflowRoomSnapshot> | WorkflowRoomSnapshot;
  subscribe?(roomId: string, listener: (snapshot: WorkflowRoomSnapshot) => void): () => void;
};

export type WorkflowViewBridge = {
  dispatch(command: WorkflowViewCommand): Promise<WorkflowViewSnapshot> | WorkflowViewSnapshot;
  snapshot(): Promise<WorkflowViewSnapshot> | WorkflowViewSnapshot;
  subscribe?(listener: (snapshot: WorkflowViewSnapshot) => void): () => void;
};

export type WorkflowRoomDecisionRecorder = Pick<WorkflowRoomAdapter, "recordDecision"> & {
  lastDecision?: WorkflowRoomDecision;
};

export type CreateMemoryWorkflowRoomAdapterInput = {
  idPrefix?: string;
  now?: () => string;
  snapshot: WorkflowRoomSnapshot;
};

export type MemoryWorkflowRoomAdapter = WorkflowRoomAdapter & {
  snapshot(): WorkflowRoomSnapshot;
};

export function createMemoryWorkflowRoomAdapter(
  input: CreateMemoryWorkflowRoomAdapterInput,
): MemoryWorkflowRoomAdapter {
  const idPrefix = input.idPrefix ?? "memory";
  const now = input.now ?? (() => new Date().toISOString());
  const listeners = new Set<(snapshot: WorkflowRoomSnapshot) => void>();
  const counts = {
    decision: input.snapshot.decisions.length,
    event: input.snapshot.events.length,
    message: input.snapshot.messages.length,
    run: input.snapshot.workflowRuns.length,
  };
  let snapshot = cloneWorkflowRoomSnapshot(input.snapshot);

  function assertRoom(roomId: string): void {
    if (roomId !== snapshot.id) {
      throw new Error(`Workflow room ${roomId} not found.`);
    }
  }

  function nextId(kind: keyof typeof counts): string {
    counts[kind] += 1;
    return `${idPrefix}_${kind}_${counts[kind]}`;
  }

  function emit(): WorkflowRoomSnapshot {
    const current = cloneWorkflowRoomSnapshot(snapshot);
    for (const listener of listeners) {
      listener(cloneWorkflowRoomSnapshot(current));
    }
    return current;
  }

  return {
    appendEvent(eventInput) {
      assertRoom(eventInput.roomId);
      const timestamp = eventInput.createdAt ?? now();
      const event: WorkflowRoomEvent = {
        actorParticipantId: eventInput.actorParticipantId,
        createdAt: timestamp,
        id: nextId("event"),
        kind: eventInput.kind,
        payload: eventInput.payload,
      };
      snapshot = {
        ...snapshot,
        events: [
          ...snapshot.events,
          event,
        ],
        updatedAt: timestamp,
      };
      return emit();
    },
    appendMessage(messageInput) {
      assertRoom(messageInput.roomId);
      snapshot = {
        ...snapshot,
        messages: [
          ...snapshot.messages,
          {
            content: messageInput.content,
            createdAt: now(),
            id: nextId("message"),
            metadata: messageInput.metadata,
            participantId: messageInput.participantId,
            role: messageInput.role ?? "user",
            visibility: messageInput.visibility ?? "public",
          },
        ],
        updatedAt: now(),
      };
      return emit();
    },
    getSnapshot(roomId) {
      assertRoom(roomId);
      return cloneWorkflowRoomSnapshot(snapshot);
    },
    linkWorkflowRun(runInput) {
      assertRoom(runInput.roomId);
      const timestamp = now();
      snapshot = {
        ...snapshot,
        updatedAt: timestamp,
        workflowRuns: [
          ...snapshot.workflowRuns,
          {
            createdAt: timestamp,
            executionId: runInput.executionId,
            id: nextId("run"),
            metadata: runInput.metadata,
            runId: runInput.runId,
            status: runInput.status,
            updatedAt: timestamp,
            workflowId: runInput.workflowId,
          },
        ],
      };
      return emit();
    },
    recordDecision(decisionInput) {
      assertRoom(decisionInput.roomId);
      snapshot = {
        ...snapshot,
        decisions: [
          ...snapshot.decisions,
          {
            content: decisionInput.content,
            createdAt: now(),
            id: nextId("decision"),
            messageId: decisionInput.messageId,
            title: decisionInput.title,
          },
        ],
        updatedAt: now(),
      };
      return emit();
    },
    resolveHandRaise(handRaiseInput) {
      assertRoom(handRaiseInput.roomId);
      snapshot = {
        ...snapshot,
        handRaises: snapshot.handRaises.map((handRaise) =>
          handRaise.id === handRaiseInput.handRaiseId
            ? {
                ...handRaise,
                resolvedAt: now(),
                resolvedByMessageId: handRaiseInput.resolvedByMessageId,
                status: handRaiseInput.status ?? "resolved",
              }
            : handRaise
        ),
        updatedAt: now(),
      };
      return emit();
    },
    snapshot() {
      return cloneWorkflowRoomSnapshot(snapshot);
    },
    subscribe(roomId, listener) {
      assertRoom(roomId);
      listeners.add(listener);
      listener(cloneWorkflowRoomSnapshot(snapshot));
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function cloneWorkflowRoomSnapshot(snapshot: WorkflowRoomSnapshot): WorkflowRoomSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkflowRoomSnapshot;
}
