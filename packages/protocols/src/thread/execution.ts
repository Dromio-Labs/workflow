import type { DromioActorReference, DromioJsonObject, DromioJsonValue } from "./identity.js";
import type { DromioContentPart } from "./resources.js";

export const dromioTurnStatuses = [
  "queued",
  "eligible",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
] as const;

export type DromioTurnStatus = (typeof dromioTurnStatuses)[number];

export interface DromioModelSelectionV1 {
  readonly modelId: string;
  readonly providerId: string;
  readonly reasoningEffort?: string;
}

export interface DromioTurnV1 {
  readonly schemaVersion: "dromio.turn.v1";
  readonly id: string;
  readonly threadId: string;
  readonly ordinal: number;
  readonly status: DromioTurnStatus;
  readonly inputItemIds: readonly string[];
  readonly modelSelection?: DromioModelSelectionV1;
  readonly createdBy: DromioActorReference;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly provenance?: import("./identity.js").DromioResourceProvenance;
  readonly retryOfTurnId?: string;
  readonly regeneratedFromTurnId?: string;
  readonly executionRunId?: string;
  readonly executionAttemptId?: string;
  readonly executionFencingToken?: number;
  readonly contextSnapshotId?: string;
  readonly statusReason?: string;
}

export interface DromioInteractionBase {
  readonly schemaVersion: "dromio.interaction-request.v1";
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly status: "pending" | "resolved" | "expired" | "cancelled";
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: DromioActorReference;
  readonly version: number;
}

export interface DromioApprovalRequest extends DromioInteractionBase {
  readonly kind: "approval";
  readonly operation: string;
  readonly toolVersion: string;
  readonly capabilityId?: string;
  readonly argumentsDigest: string;
  readonly risk?: string;
  readonly requestedPermissions: readonly string[];
  readonly decision?: "approved" | "denied";
}

export interface DromioQuestionRequest extends DromioInteractionBase {
  readonly kind: "question" | "form";
  readonly prompt: string;
  readonly answerSchema: DromioJsonObject;
  readonly answer?: DromioJsonValue;
}

export type DromioInteractionRequestV1 = DromioApprovalRequest | DromioQuestionRequest;

export interface DromioExecutionCommandV1 {
  readonly schemaVersion: "dromio.execution-command.v1";
  readonly commandId: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly operation: "execute_thread_turn" | "resume_thread_turn" | "cancel_thread_turn" | "steer_thread_turn";
  readonly tenantId: string;
  readonly applicationId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly turnOrdinal: number;
  readonly generation: number;
  readonly createdAt: string;
  readonly payload?: DromioJsonObject;
}

export interface DromioExecutionAttemptReference {
  readonly runId: string;
  readonly attemptId: string;
  readonly attempt: number;
  readonly fencingToken: number;
}

export interface DromioContextSnapshotV1 {
  readonly schemaVersion: "dromio.context-snapshot.v1";
  readonly id: string;
  readonly executionRunId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly threadSequence: number;
  readonly modelId: string;
  readonly itemRevisionIds: readonly string[];
  readonly instructionRevisionIds: readonly string[];
  readonly summaryIds: readonly string[];
  readonly tokenBudget: number;
  readonly estimatedTokens: number;
  readonly policyVersion: string;
  readonly entries: readonly DromioContextEntryV1[];
  readonly createdAt: string;
}

export interface DromioContextEntryV1 {
  readonly source: {
    readonly type: "item_revision" | "instruction_revision" | "summary";
    readonly id: string;
  };
  readonly role: "user" | "assistant" | "system" | "developer" | "tool";
  readonly content: readonly DromioContentPart[];
  readonly estimatedTokens: number;
}

export interface DromioContextSummaryV1 {
  readonly schemaVersion: "dromio.context-summary.v1";
  readonly id: string;
  readonly threadId: string;
  readonly coversFromTurnOrdinal?: number;
  readonly coversThroughTurnOrdinal: number;
  readonly sourceItemRevisionIds: readonly string[];
  readonly content: readonly DromioContentPart[];
  readonly kind?: "leaf" | "hierarchical";
  readonly requestedBy?: "automatic" | "manual";
  readonly sourceSummaryIds?: readonly string[];
  readonly replacesSummaryIds?: readonly string[];
  readonly status: "generating" | "ready" | "invalidated" | "failed";
  readonly modelId: string;
  readonly promptVersion: string;
  readonly failureCode?: string;
  readonly createdAt: string;
}

export interface DromioTriggerOccurrenceV1 {
  readonly schemaVersion: "dromio.trigger-occurrence.v1";
  readonly id: string;
  readonly type: "chat" | "manual" | "schedule" | "webhook" | "event";
  readonly tenantId: string;
  readonly applicationId: string;
  readonly triggerId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly commandId: string;
  readonly occurredAt: string;
  readonly payload: DromioJsonObject;
}
