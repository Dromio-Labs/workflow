import type { JsonObject, JsonValue } from "./json.js";

export type WorkflowRoomKind = "local" | "custom";

export type WorkflowRoomStatus = "active" | "archived" | "ended" | "paused";

export type WorkflowRoomParticipant = {
  agentId?: string;
  displayName: string;
  id: string;
  joinedAt?: string;
  kind: "agent" | "human" | "system" | string;
  status?: string;
};

export type WorkflowRoomMessage = {
  content: string;
  createdAt?: string;
  id: string;
  metadata?: JsonObject;
  participantId?: string;
  role: "assistant" | "system" | "tool" | "user" | string;
  visibility?: "private" | "public" | string;
};

export type WorkflowRoomDecision = {
  content: JsonValue;
  createdAt?: string;
  id: string;
  messageId?: string;
  title: string;
};

export type WorkflowRoomArtifact = {
  content: JsonValue;
  createdAt?: string;
  id: string;
  status: "approved" | "proposed" | "rejected" | string;
  title: string;
  type: string;
  updatedAt?: string;
};

export type WorkflowRoomHandRaise = {
  agentSessionId?: string;
  createdAt?: string;
  id: string;
  metadata?: JsonObject;
  priority?: "high" | "low" | "normal" | string;
  question: string;
  reason?: string;
  resolvedAt?: string;
  resolvedByMessageId?: string;
  status: "dismissed" | "open" | "resolved" | string;
};

export type WorkflowRoomRunLink = {
  agentSessionId?: string;
  createdAt?: string;
  executionId?: string;
  id: string;
  metadata?: JsonObject;
  runId?: string;
  status: string;
  updatedAt?: string;
  workflowId: string;
};

export type WorkflowRoomEvent = {
  actorParticipantId?: string;
  createdAt?: string;
  id: string;
  kind: string;
  payload: JsonObject;
};

export type WorkflowRoomSnapshot = {
  adapter?: {
    id: string;
    label?: string;
  };
  artifacts: WorkflowRoomArtifact[];
  decisions: WorkflowRoomDecision[];
  events: WorkflowRoomEvent[];
  handRaises: WorkflowRoomHandRaise[];
  id: string;
  kind: WorkflowRoomKind;
  messages: WorkflowRoomMessage[];
  metadata: JsonObject;
  participants: WorkflowRoomParticipant[];
  status: WorkflowRoomStatus;
  title?: string;
  updatedAt?: string;
  workflowRuns: WorkflowRoomRunLink[];
};
