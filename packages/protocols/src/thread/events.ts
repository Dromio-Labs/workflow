import type { DromioJsonObject } from "./identity.js";

export const dromioThreadEventTypes = [
  "thread.created",
  "thread.updated",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
  "thread.forked",
  "thread.migrated",
  "thread.access.changed",
  "item.created",
  "item.revised",
  "item.withdrawn",
  "item.deleted",
  "item.redacted",
  "message.output_text.delta",
  "tool_call.changed",
  "turn.queued",
  "turn.eligible",
  "turn.started",
  "turn.waiting_for_approval",
  "turn.waiting_for_input",
  "turn.completed",
  "turn.failed",
  "turn.cancelling",
  "turn.cancelled",
  "interaction.created",
  "interaction.resolved",
  "interaction.expired",
  "file.changed",
  "context.summary.changed",
] as const;

export type DromioThreadEventType = (typeof dromioThreadEventTypes)[number];

export interface DromioThreadEventV1 {
  readonly schemaVersion: "dromio.thread-event.v1";
  readonly eventId: string;
  readonly type: DromioThreadEventType;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly threadId: string;
  readonly sequence: number;
  readonly applicationSequence: number;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly requestId?: string;
  readonly commandId?: string;
  readonly causationId?: string;
  readonly payload: DromioJsonObject;
}

export const dromioUserEventTypes = [
  "user_state.updated",
  "draft.saved",
  "draft.deleted",
] as const;

export type DromioUserEventType = (typeof dromioUserEventTypes)[number];

/** Private application-feed event. It must never be written to a shared thread feed. */
export interface DromioUserEventV1 {
  readonly schemaVersion: "dromio.user-event.v1";
  readonly eventId: string;
  readonly type: DromioUserEventType;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly userId: string;
  readonly threadId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly commandId: string;
  readonly causationId?: string;
  readonly payload: DromioJsonObject;
}

export const dromioThreadCommandNames = [
  "threads.create",
  "threads.update",
  "threads.archive",
  "threads.unarchive",
  "threads.delete",
  "threads.fork",
  "turns.create",
  "turns.retry",
  "turns.regenerate",
  "turns.steer",
  "turns.interrupt",
  "turns.cancel",
  "interactions.resolve",
  "items.revise",
  "items.withdraw",
  "items.delete",
  "items.redact",
  "participants.grant",
  "participants.revoke",
  "user_state.update",
  "share_links.create",
  "drafts.save",
  "drafts.delete",
  "exports.create",
  "retention.set",
  "legal_holds.create",
  "legal_holds.release",
  "threads.purge",
] as const;

export type DromioThreadCommandName = (typeof dromioThreadCommandNames)[number];

export interface DromioThreadCommandV1 {
  readonly schemaVersion: "dromio.thread-command.v1";
  readonly commandId: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly name: DromioThreadCommandName;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly threadId?: string;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
  readonly timestamp: string;
  readonly payload: DromioJsonObject;
}

export interface DromioCommandReceiptV1<Resource> {
  readonly schemaVersion: "dromio.command-receipt.v1";
  readonly commandId: string;
  readonly resource: Resource;
  readonly applicationSequence?: number;
  readonly userSequence?: number;
  readonly threadSequence?: number;
  readonly replayed: boolean;
}

export const dromioApiErrorCodes = [
  "authentication_required",
  "permission_denied",
  "resource_not_found",
  "validation_failed",
  "idempotency_conflict",
  "version_conflict",
  "interaction_already_resolved",
  "stale_execution_attempt",
  "turn_not_eligible",
  "steering_not_supported",
  "retention_locked",
  "cursor_expired",
  "sequence_gap",
  "rate_limited",
  "provider_unavailable",
  "storage_unavailable",
  "internal_error",
] as const;

export type DromioApiErrorCode = (typeof dromioApiErrorCodes)[number];

export interface DromioApiErrorV1 {
  readonly schemaVersion: "dromio.api-error.v1";
  readonly error: {
    readonly code: DromioApiErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly retryable: boolean;
    readonly retryAfterMs?: number;
    readonly details?: DromioJsonObject;
  };
}
