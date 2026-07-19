import type {
  DromioActorReference,
  DromioJsonObject,
  DromioJsonValue,
  DromioResourceProvenance,
} from "./identity.js";

export const dromioThreadStatuses = ["active", "archived", "deleting", "purged"] as const;
export type DromioThreadStatus = (typeof dromioThreadStatuses)[number];

export interface DromioThreadV1 {
  readonly schemaVersion: "dromio.thread.v1";
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly title: string;
  readonly labels: readonly string[];
  readonly status: DromioThreadStatus;
  readonly createdBy: DromioActorReference;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly lastSequence: number;
  readonly lastItemOrdinal: number;
  readonly lastTurnOrdinal: number;
  readonly provenance?: DromioResourceProvenance;
  readonly parentThreadId?: string;
  readonly forkedFromTurnId?: string;
  readonly metadata?: DromioJsonObject;
  readonly metadataSchema?: string;
  readonly metadataIndex?: Readonly<Record<string, "string" | "number" | "boolean">>;
}

export interface DromioTextPart {
  readonly type: "text";
  readonly text: string;
}

export interface DromioMediaPart {
  readonly type: "image" | "audio" | "video";
  readonly fileId: string;
  readonly mediaType: string;
}

export interface DromioFilePart {
  readonly type: "file";
  readonly fileId: string;
  readonly version: number;
  readonly mediaType: string;
  readonly name: string;
}

export interface DromioStructuredDataPart {
  readonly type: "structured_data";
  readonly schema: string;
  readonly value: DromioJsonValue;
}

export interface DromioCitationPart {
  readonly type: "citation";
  readonly uri: string;
  readonly title?: string;
  readonly start?: number;
  readonly end?: number;
}

export interface DromioArtifactReferencePart {
  readonly type: "artifact";
  readonly artifactId: string;
}

export interface DromioApplicationPart {
  readonly type: "application";
  readonly schema: string;
  readonly value: DromioJsonValue;
}

export type DromioContentPart =
  | DromioTextPart
  | DromioMediaPart
  | DromioFilePart
  | DromioStructuredDataPart
  | DromioCitationPart
  | DromioArtifactReferencePart
  | DromioApplicationPart;

export interface DromioThreadItemBase {
  readonly id: string;
  readonly threadId: string;
  readonly turnId?: string;
  readonly ordinal: number;
  readonly createdAt: string;
  readonly createdBy: DromioActorReference;
  readonly provenance?: DromioResourceProvenance;
}

export interface DromioMessageRevision {
  readonly id: string;
  readonly messageId: string;
  readonly revision: number;
  readonly content: readonly DromioContentPart[];
  readonly createdAt: string;
  readonly createdBy: DromioActorReference;
  readonly reason: "creation" | "author_edit" | "withdrawal" | "redaction" | "deletion" | "migration";
}

export interface DromioMessageItem extends DromioThreadItemBase {
  readonly type: "message";
  readonly role: "user" | "assistant" | "system" | "developer";
  readonly author: DromioActorReference;
  readonly content: readonly DromioContentPart[];
  readonly status: "in_progress" | "completed" | "failed" | "withdrawn" | "deleted" | "redacted";
  readonly revision: number;
  readonly contextVisibility: "model_and_user" | "user_only" | "model_only" | "excluded";
}

export interface DromioToolCallItem extends DromioThreadItemBase {
  readonly type: "tool_call";
  readonly toolId: string;
  readonly toolVersion: string;
  readonly capabilityId?: string;
  readonly arguments: DromioJsonObject;
  readonly effect: "read_only" | "idempotent" | "non_idempotent";
  readonly recoveryPolicy: "automatic_retry" | "manual_reconciliation";
  readonly idempotencyKey?: string;
  readonly status: "proposed" | "waiting_for_approval" | "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly approvalRequestId?: string;
  readonly result?: DromioJsonValue;
  readonly artifactIds?: readonly string[];
}

export interface DromioReferenceItem extends DromioThreadItemBase {
  readonly type: "approval_request" | "question" | "form" | "artifact" | "context_compaction";
  readonly resourceId: string;
  readonly status: string;
}

export interface DromioSystemNoticeItem extends DromioThreadItemBase {
  readonly type: "system_notice";
  readonly code: string;
  readonly message: string;
}

export type DromioThreadItemV1 =
  | DromioMessageItem
  | DromioToolCallItem
  | DromioReferenceItem
  | DromioSystemNoticeItem;
